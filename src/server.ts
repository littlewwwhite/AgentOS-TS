// input: HTTP requests, websocket frames, sandbox protocol commands
// output: Thin host bridge exposing REST + WebSocket access to project-scoped sandboxes
// pos: Host entrypoint for the web MVP — forwards existing protocol without reshaping it

import http, { type IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { parseCommand, type SandboxCommand, type SandboxEvent } from "./protocol.js";
import { SandboxManager, type SandboxEntry } from "./sandbox-manager.js";
import type { ProjectSession } from "./session-store.js";

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
  listFiles(projectId: string, path: string): Promise<SandboxEntry[]>;
  readTextFile(projectId: string, path: string): Promise<string>;
  readBinaryFile(projectId: string, path: string): Promise<Uint8Array>;
  getDownloadUrl(projectId: string, path: string): Promise<string>;
}

export interface AgentOsServerOptions {
  host?: string;
  port?: number;
  workspaceRoot?: string;
  manager?: HostBridgeManager;
}

export interface AgentOsServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

const DEFAULT_HOST = process.env.AGENTOS_WEB_HOST ?? "0.0.0.0";
const DEFAULT_PORT = Number(process.env.AGENTOS_WEB_PORT ?? "3001");
const DEFAULT_WORKSPACE_ROOT = "/home/user/app/workspace";

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

function getProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/api\/projects\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getProjectFilePath(
  pathname: string,
  suffix: "tree" | "read" | "download",
): string | null {
  const match = pathname.match(
    new RegExp(`^/api/projects/([^/]+)/files/${suffix}$`),
  );
  return match ? decodeURIComponent(match[1]) : null;
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

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

export async function startAgentOsServer(
  options: AgentOsServerOptions = {},
): Promise<AgentOsServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const workspaceRoot = options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;
  const manager = options.manager ?? new SandboxManager();

  const wsServer = new WebSocketServer({ noServer: true });

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendError(res, 400, "Missing request URL");
        return;
      }

      const reqUrl = new URL(req.url, `http://${req.headers.host ?? host}`);
      const { pathname } = reqUrl;

      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && pathname === "/api/projects") {
        sendJson(res, 200, manager.list());
        return;
      }

      const projectId = getProjectId(pathname);
      if (projectId && req.method === "POST") {
        const session = await manager.getOrCreate(projectId);
        sendJson(res, 200, session);
        return;
      }

      if (projectId && req.method === "DELETE") {
        await manager.destroy(projectId);
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

        const entries = await manager.listFiles(treeProjectId, targetPath);
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
          const content = await manager.readBinaryFile(readProjectId, targetPath);
          sendJson(res, 200, {
            path: targetPath,
            format,
            content: Buffer.from(content).toString("base64"),
          });
          return;
        }

        const content = await manager.readTextFile(readProjectId, targetPath);
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

        const downloadUrl = await manager.getDownloadUrl(downloadProjectId, targetPath);
        res.writeHead(302, { location: downloadUrl, "cache-control": "no-store" });
        res.end();
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
    const projectId = getWebSocketProjectId(reqUrl.pathname);
    if (!projectId) {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wsServer.emit("connection", ws, req, projectId);
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
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
