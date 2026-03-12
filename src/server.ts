// input: HTTP requests, websocket frames, sandbox protocol commands
// output: Thin host bridge exposing REST + WebSocket access to project-scoped sandboxes
// pos: Host entrypoint for the web MVP — forwards existing protocol without reshaping it

import http, { type IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  extractLogicalProjectId,
  findOrCreateUser,
  scopeProjectId,
  verifySessionToken,
} from "./auth.js";
import { SessionStore, type ProjectSession } from "./session-store.js";
import { loadEnvToProcess } from "./env.js";
import { parseCommand, type SandboxCommand, type SandboxEvent } from "./protocol.js";
import {
  SandboxManager,
  type SandboxEntry,
  type SandboxFileContent,
} from "./sandbox-manager.js";

export interface HostBridgeManager {
  list(): ProjectSession[];
  get(projectId: string): ProjectSession | null;
  getOrCreate(projectId: string): Promise<ProjectSession>;
  attach(
    projectId: string,
    listener: (event: SandboxEvent) => void,
  ): Promise<() => void>;
  sendCommand(projectId: string, cmd: SandboxCommand): Promise<void>;
  destroy(projectId: string): Promise<void>;
  destroyAll?(): Promise<void>;
  listFiles(projectId: string, path: string): Promise<SandboxEntry[]>;
  readTextFile(projectId: string, path: string): Promise<string>;
  readBinaryFile(projectId: string, path: string): Promise<Uint8Array>;
  getDownloadUrl(projectId: string, path: string): Promise<string>;
  writeTextFile(projectId: string, path: string, content: string): Promise<void>;
  uploadFile(projectId: string, path: string, content: SandboxFileContent): Promise<void>;
  syncTextFiles(
    projectId: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<string[]>;
}

export interface AgentOsServerOptions {
  host?: string;
  port?: number;
  workspaceRoot?: string;
  manager?: HostBridgeManager;
  authSecret?: string;
  sessionStore?: SessionStore;
}

export interface AgentOsServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

// Load .env into process.env before reading defaults
loadEnvToProcess(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"));

const DEFAULT_HOST = process.env.AGENTOS_WEB_HOST ?? "0.0.0.0";
const DEFAULT_PORT = Number(process.env.AGENTOS_WEB_PORT ?? "3001");
const DEFAULT_WORKSPACE_ROOT = "/home/user/app/workspace";
const DEFAULT_AUTH_SECRET = process.env.AGENTOS_AUTH_SECRET ?? "agentos-dev-secret";

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendError(
  res: http.ServerResponse,
  status: number,
  message: string,
): void {
  sendJson(res, status, { error: message });
}

function getBearerToken(req: IncomingMessage, reqUrl?: URL): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  const queryToken = reqUrl?.searchParams.get("token");
  return queryToken || null;
}

function requireUserId(
  req: IncomingMessage,
  reqUrl: URL,
  authSecret: string,
): string | null {
  const token = getBearerToken(req, reqUrl);
  if (!token) {
    return null;
  }

  return verifySessionToken(token, authSecret)?.userId ?? null;
}

function getProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/api\/projects\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getProjectFilePath(
  pathname: string,
  suffix: "tree" | "read" | "download" | "write" | "sync" | "upload",
): string | null {
  const match = pathname.match(
    new RegExp(`^/api/projects/([^/]+)/files/${suffix}$`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function getWebSocketProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/ws\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getRequiredPath(
  reqUrl: URL,
  fallback?: string,
): string | null {
  const pathParam = reqUrl.searchParams.get("path");
  if (pathParam) {
    return pathParam;
  }
  return fallback ?? null;
}

function parseUploadPayload(
  body: unknown,
): { path: string; content: SandboxFileContent; bytes: number } | null {
  if (!body || typeof body !== "object" || typeof (body as { path?: unknown }).path !== "string") {
    return null;
  }

  const path = (body as { path: string }).path;
  const textContent = (body as { content?: unknown }).content;
  if (typeof textContent === "string") {
    return {
      path,
      content: textContent,
      bytes: Buffer.byteLength(textContent, "utf-8"),
    };
  }

  const base64Content = (body as { contentBase64?: unknown }).contentBase64;
  if (typeof base64Content === "string") {
    const content = Uint8Array.from(Buffer.from(base64Content, "base64"));
    return {
      path,
      content,
      bytes: content.byteLength,
    };
  }

  return null;
}

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

function toPublicSession(
  session: ProjectSession,
  userId: string,
): ProjectSession & { userId: string } {
  const logicalProjectId = extractLogicalProjectId(session.projectId);
  const publicSandboxId =
    session.sandboxId === `sbx_${session.projectId}`
      ? `sbx_${logicalProjectId}`
      : session.sandboxId;

  return {
    ...session,
    projectId: logicalProjectId,
    sandboxId: publicSandboxId,
    userId,
  };
}

export async function startAgentOsServer(
  options: AgentOsServerOptions = {},
): Promise<AgentOsServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const manager = options.manager ?? new SandboxManager({
    onStderr: (projectId, data) => {
      const trimmed = data.trim();
      if (trimmed) console.error(`[sandbox:${projectId}] ${trimmed}`);
    },
  });
  const authSecret = options.authSecret ?? DEFAULT_AUTH_SECRET;
  const sessionStore = options.sessionStore ?? new SessionStore();

  const wsServer = new WebSocketServer({ noServer: true });

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendError(res, 400, "Missing request URL");
        return;
      }

      const reqUrl = new URL(req.url, `http://${req.headers.host ?? host}`);
      const { pathname } = reqUrl;

      // CORS headers for cross-origin requests from the frontend dev server
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && pathname === "/api/auth/session") {
        const existingToken = getBearerToken(req, reqUrl);
        const session = findOrCreateUser(sessionStore, existingToken, authSecret);
        sendJson(res, 200, session);
        return;
      }

      const userId = requireUserId(req, reqUrl, authSecret);
      if (!userId) {
        sendError(res, 401, "Unauthorized");
        return;
      }

      if (req.method === "GET" && pathname === "/api/projects") {
        const scopedPrefix = `${userId}:`;
        const sessions = manager.list()
          .filter((session) => session.projectId.startsWith(scopedPrefix))
          .map((session) => toPublicSession(session, userId));
        sendJson(res, 200, sessions);
        return;
      }

      const projectId = getProjectId(pathname);
      if (projectId && req.method === "POST") {
        const session = await manager.getOrCreate(scopeProjectId(userId, projectId));
        sendJson(res, 200, toPublicSession(session, userId));
        return;
      }

      if (projectId && req.method === "DELETE") {
        await manager.destroy(scopeProjectId(userId, projectId));
        sendJson(res, 200, { ok: true });
        return;
      }

      const treeProjectId = getProjectFilePath(pathname, "tree");
      if (treeProjectId && req.method === "GET") {
        const targetPath = getRequiredPath(reqUrl, workspaceRoot);
        if (!targetPath) {
          sendError(res, 400, "Missing file tree path");
          return;
        }

        const entries = await manager.listFiles(scopeProjectId(userId, treeProjectId), targetPath);
        sendJson(res, 200, {
          projectId: treeProjectId,
          root: targetPath,
          entries,
        });
        return;
      }

      const readProjectId = getProjectFilePath(pathname, "read");
      if (readProjectId && req.method === "GET") {
        const targetPath = getRequiredPath(reqUrl);
        if (!targetPath) {
          sendError(res, 400, "Missing file read path");
          return;
        }

        const format = reqUrl.searchParams.get("format") === "bytes"
          ? "bytes"
          : "text";

        if (format === "bytes") {
          const content = await manager.readBinaryFile(
            scopeProjectId(userId, readProjectId),
            targetPath,
          );
          sendJson(res, 200, {
            path: targetPath,
            format,
            content: Buffer.from(content).toString("base64"),
          });
          return;
        }

        const content = await manager.readTextFile(
          scopeProjectId(userId, readProjectId),
          targetPath,
        );
        sendJson(res, 200, {
          path: targetPath,
          format,
          content,
        });
        return;
      }

      const downloadProjectId = getProjectFilePath(pathname, "download");
      if (downloadProjectId && req.method === "GET") {
        const targetPath = getRequiredPath(reqUrl);
        if (!targetPath) {
          sendError(res, 400, "Missing file download path");
          return;
        }

        const downloadUrl = await manager.getDownloadUrl(
          scopeProjectId(userId, downloadProjectId),
          targetPath,
        );
        res.writeHead(302, { location: downloadUrl, "cache-control": "no-store" });
        res.end();
        return;
      }

      const writeProjectId = getProjectFilePath(pathname, "write");
      if (writeProjectId && req.method === "POST") {
        const body = await readJsonBody(req);
        if (
          !body ||
          typeof body !== "object" ||
          typeof (body as { path?: unknown }).path !== "string" ||
          typeof (body as { content?: unknown }).content !== "string"
        ) {
          sendError(res, 400, "Expected JSON body with string path and content");
          return;
        }

        const payload = body as { path: string; content: string };
        await manager.writeTextFile(
          scopeProjectId(userId, writeProjectId),
          payload.path,
          payload.content,
        );
        sendJson(res, 200, { ok: true, path: payload.path });
        return;
      }

      const syncProjectId = getProjectFilePath(pathname, "sync");
      if (syncProjectId && req.method === "POST") {
        const body = await readJsonBody(req);
        if (
          !body ||
          typeof body !== "object" ||
          !Array.isArray((body as { files?: unknown }).files)
        ) {
          sendError(res, 400, "Expected JSON body with files array");
          return;
        }

        const files = (body as { files: Array<{ path?: unknown; content?: unknown }> }).files;
        if (
          files.some(
            (file) => typeof file?.path !== "string" || typeof file?.content !== "string",
          )
        ) {
          sendError(res, 400, "Each file requires string path and content");
          return;
        }

        const normalized = files as Array<{ path: string; content: string }>;
        const paths = await manager.syncTextFiles(
          scopeProjectId(userId, syncProjectId),
          normalized,
        );
        sendJson(res, 200, { ok: true, paths });
        return;
      }

      const uploadProjectId = getProjectFilePath(pathname, "upload");
      if (uploadProjectId && req.method === "POST") {
        const body = await readJsonBody(req);
        const payload = parseUploadPayload(body);
        if (!payload) {
          sendError(
            res,
            400,
            "Expected JSON body with string path and either string content or base64 contentBase64",
          );
          return;
        }

        await manager.uploadFile(
          scopeProjectId(userId, uploadProjectId),
          payload.path,
          payload.content,
        );
        sendJson(res, 200, {
          ok: true,
          path: payload.path,
          bytes: payload.bytes,
        });
        return;
      }

      sendError(res, 404, "Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendError(res, 500, message);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host ?? host}`);
    const userId = requireUserId(req, reqUrl, authSecret);
    const logicalProjectId = getWebSocketProjectId(reqUrl.pathname);
    if (!userId || !logicalProjectId) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wsServer.emit("connection", ws, req, scopeProjectId(userId, logicalProjectId));
    });
  });

  wsServer.on("connection", (ws: WebSocket, _req: IncomingMessage, projectId: string) => {
    let detach: (() => void) | null = null;

    ws.on("message", async (raw: RawData) => {
      const parsed = parseCommand(raw.toString());
      if (!parsed) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid command" }));
        }
        return;
      }

      try {
        await manager.sendCommand(projectId, parsed);
      } catch (error) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
    });

    ws.on("close", () => {
      detach?.();
      detach = null;
    });

    manager.attach(projectId, (event) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    }).then((cleanup) => {
      detach = cleanup;
    }).catch((error) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        ws.close();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address");
  }

  return {
    host,
    port: address.port,
    close: async () => {
      // Destroy all active sandboxes before shutting down
      await manager.destroyAll?.();
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

if (isDirectRun()) {
  startAgentOsServer().then((server) => {
    console.log(`AgentOS web host listening on http://${server.host}:${server.port}`);

    // Graceful shutdown: destroy all sandboxes before exiting
    const shutdown = () => {
      console.log("\nShutting down...");
      server.close().then(() => process.exit(0)).catch(() => process.exit(1));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
