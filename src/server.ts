// input: SandboxClient (E2B bridge), Hono framework, Bun WebSocket, env.ts
// output: HTTP API + WebSocket event stream for frontend consumption
// pos: API bridge — connects React frontend to E2B sandbox backend

import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import type { Sandbox } from "e2b";
import { SandboxClient } from "./e2b-client.js";
import { loadDotEnv } from "./env.js";
import { parseCommand, type SandboxEvent } from "./protocol.js";

const dotEnv = loadDotEnv();

// ---------- WebSocket broadcast ----------

const wsClients = new Set<WSContext>();
let client: SandboxClient | null = null;

function broadcast(event: SandboxEvent): void {
  const data = JSON.stringify(event);
  for (const ws of wsClients) {
    try {
      ws.send(data);
    } catch {
      wsClients.delete(ws);
    }
  }
}

// ---------- File tree builder ----------

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  status: string;
  children?: FileNode[];
}

async function buildFileTree(
  sandbox: Sandbox,
  dirPath: string,
): Promise<FileNode[]> {
  const entries = await sandbox.files.list(dirPath);
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (entry.type === "dir") {
      const children = await buildFileTree(sandbox, entry.path);
      nodes.push({
        name: entry.name,
        path: entry.path,
        type: "directory",
        status: "done",
        children,
      });
    } else {
      nodes.push({
        name: entry.name,
        path: entry.path,
        type: "file",
        status: "done",
      });
    }
  }

  return nodes;
}

// ---------- Routes ----------

const app = new Hono();

// --- Sandbox lifecycle ---

app.post("/api/sandbox/start", async (c) => {
  const body = await c.req
    .json<{ templateId?: string }>()
    .catch((): { templateId?: string } => ({}));

  if (client) await client.destroy().catch(() => {});

  client = new SandboxClient({
    templateId: body.templateId ?? "agentos-sandbox",
    onEvent: broadcast,
    onStderr: (data) => console.error("[sandbox stderr]", data),
    envs: {
      ANTHROPIC_API_KEY: dotEnv.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
      ANTHROPIC_BASE_URL: dotEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "",
    },
  });

  await client.start();
  return c.json({ sandboxId: client.sandboxId });
});

app.delete("/api/sandbox", async (c) => {
  if (client) {
    await client.destroy();
    client = null;
  }
  return c.json({ ok: true });
});

// --- WebSocket (chat + events) ---

app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      wsClients.add(ws);
      ws.send(
        JSON.stringify({
          type: "status",
          state: client?.isConnected ? "idle" : "disconnected",
        }),
      );
    },

    onMessage(event, ws) {
      const cmd = parseCommand(String(event.data));
      if (!cmd) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid command" }));
        return;
      }

      if (!client?.isConnected) {
        ws.send(
          JSON.stringify({ type: "error", message: "Sandbox not connected" }),
        );
        return;
      }

      switch (cmd.cmd) {
        case "chat":
          client.chat(cmd.message).catch((err) => {
            ws.send(
              JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              }),
            );
          });
          break;
        case "interrupt":
          client.interrupt().catch(() => {});
          break;
      }
    },

    onClose(_event, ws) {
      wsClients.delete(ws);
    },
  })),
);

app.get("/api/sandbox/status", (c) => {
  return c.json({
    connected: client?.isConnected ?? false,
    sandboxId: client?.sandboxId ?? null,
    state: client?.isConnected ? "ready" : "disconnected",
  });
});

// --- Workspace files ---

app.get("/api/workspace/files", async (c) => {
  const sandbox = client?.sandbox;
  if (!sandbox) return c.json([]);
  const basePath = c.req.query("path") ?? "/home/user/app/workspace";
  try {
    const tree = await buildFileTree(sandbox, basePath);
    return c.json(tree);
  } catch {
    return c.json([]);
  }
});

app.get("/api/workspace/file", async (c) => {
  const filePath = c.req.query("path");
  if (!filePath) return c.json({ error: "path query required" }, 400);

  const sandbox = client?.sandbox;
  if (!sandbox) return c.json({ error: "Sandbox not connected" }, 400);

  const content = await sandbox.files.read(filePath);
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const typeMap: Record<string, string> = {
    md: "markdown",
    json: "json",
    png: "image",
    jpg: "image",
    jpeg: "image",
    webp: "image",
    svg: "image",
    mp4: "video",
    webm: "video",
    mov: "video",
    mp3: "audio",
    wav: "audio",
  };

  return c.json({ content, type: typeMap[ext] ?? "text" });
});

// ---------- Start ----------

const port = Number(process.env.API_PORT) || 3001;
console.log(`AgentOS API server → http://localhost:${port}`);

export default { port, fetch: app.fetch, websocket, idleTimeout: 255 };
