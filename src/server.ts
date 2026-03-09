// input: SandboxClient (E2B bridge), Hono framework
// output: HTTP API + SSE event stream for frontend consumption
// pos: API bridge — connects React frontend to E2B sandbox backend

import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Sandbox } from "e2b";
import { SandboxClient } from "./e2b-client.js";
import type { SandboxEvent } from "./protocol.js";

// ---------- .env loader (bypass Claude Code env hijacking) ----------

function readEnvFile(path: string): Record<string, string> {
  try {
    const vars: Record<string, string> = {};
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return vars;
  } catch {
    return {};
  }
}

const dotEnv = readEnvFile(".env");

// ---------- SSE broadcast ----------

interface SSEWriter {
  writeSSE(msg: { event?: string; data: string }): Promise<void>;
}

const sseClients = new Set<SSEWriter>();
let client: SandboxClient | null = null;

function broadcast(event: SandboxEvent): void {
  const data = JSON.stringify(event);
  for (const writer of sseClients) {
    writer.writeSSE({ event: event.type, data }).catch(() => {
      sseClients.delete(writer);
    });
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

app.post("/api/sandbox/chat", async (c) => {
  const { message } = await c.req.json<{ message: string }>();
  if (!client?.isConnected) {
    return c.json({ error: "Sandbox not connected" }, 400);
  }
  try {
    await client.chat(message);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

app.post("/api/sandbox/interrupt", async (c) => {
  if (!client?.isConnected) {
    return c.json({ error: "Sandbox not connected" }, 400);
  }
  await client.interrupt();
  return c.json({ ok: true });
});

app.get("/api/sandbox/status", (c) => {
  return c.json({
    connected: client?.isConnected ?? false,
    sandboxId: client?.sandboxId ?? null,
    state: client?.isConnected ? "ready" : "disconnected",
  });
});

// --- SSE event stream ---

app.get("/api/sandbox/events", (c) => {
  return streamSSE(c, async (stream) => {
    sseClients.add(stream as unknown as SSEWriter);
    stream.onAbort(() => { sseClients.delete(stream as unknown as SSEWriter); });

    // Send current sandbox status on connect
    await stream.writeSSE({
      event: "status",
      data: JSON.stringify({
        type: "status",
        state: client?.isConnected ? "idle" : "disconnected",
      }),
    });

    // Keep alive with heartbeat
    while (true) {
      await stream.sleep(30_000);
    }
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

export default { port, fetch: app.fetch, idleTimeout: 255 };
