import { createAgentSession, type AgentSession } from "./src/orchestrator";
import type { ServerWebSocket } from "bun";
import { join, normalize } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { rename, unlink } from "fs/promises";
import { safeResolve, walkTree, mimeFor } from "./src/serverUtils";

const WORKSPACE = join(import.meta.dir, "../../workspace");

interface WsSlot {
  project: string | null;
  session: AgentSession | null;
}

const sessions = new WeakMap<ServerWebSocket<unknown>, WsSlot>();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

function scanProjects() {
  return readdirSync(WORKSPACE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const stateFile = join(WORKSPACE, d.name, "pipeline-state.json");
      if (!existsSync(stateFile)) return null;
      try {
        const state = JSON.parse(readFileSync(stateFile, "utf-8"));
        return { name: d.name, state };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const tA = a!.state.updated_at ?? "";
      const tB = b!.state.updated_at ?? "";
      return tB.localeCompare(tA);
    });
}

Bun.serve({
  port: 3001,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket 升级
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) return new Response("WebSocket upgrade failed", { status: 500 });
      return undefined;
    }

    // 保留原有 REST API
    if (url.pathname === "/api/projects") {
      return Response.json(scanProjects(), { headers: CORS });
    }

    const m = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (m) {
      const stateFile = join(WORKSPACE, decodeURIComponent(m[1]), "pipeline-state.json");
      if (!existsSync(stateFile)) {
        return Response.json({ error: "not found" }, { status: 404, headers: CORS });
      }
      return Response.json(JSON.parse(readFileSync(stateFile, "utf-8")), { headers: CORS });
    }

    const treeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/tree$/);
    if (treeMatch) {
      const projectRoot = join(WORKSPACE, decodeURIComponent(treeMatch[1]));
      if (!existsSync(projectRoot)) {
        return Response.json({ error: "not found" }, { status: 404, headers: CORS });
      }
      const includeDraft = url.searchParams.get("include_draft") === "1";
      const tree = walkTree(projectRoot, { maxDepth: 4, includeDraft });
      return Response.json(tree, { headers: CORS });
    }

    const fileMatch = url.pathname.match(/^\/files\/([^/]+)\/(.+)$/);
    if (fileMatch) {
      const projectRoot = join(WORKSPACE, decodeURIComponent(fileMatch[1]));
      if (!existsSync(projectRoot)) {
        return new Response("not found", { status: 404 });
      }
      let abs: string;
      try {
        abs = safeResolve(projectRoot, decodeURIComponent(fileMatch[2]));
      } catch {
        return new Response("forbidden", { status: 403 });
      }
      if (!existsSync(abs)) return new Response("not found", { status: 404 });
      const file = Bun.file(abs);
      const mime = mimeFor(abs);
      const range = req.headers.get("range");
      if (range && mime.startsWith("video/")) {
        const size = file.size;
        const m = range.match(/bytes=(\d+)-(\d*)/);
        if (m) {
          const start = parseInt(m[1], 10);
          const end = m[2] ? parseInt(m[2], 10) : size - 1;
          const slice = file.slice(start, end + 1);
          return new Response(slice, {
            status: 206,
            headers: {
              "Content-Type": mime,
              "Content-Range": `bytes ${start}-${end}/${size}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(end - start + 1),
            },
          });
        }
      }
      return new Response(file, {
        headers: { "Content-Type": mime, "Accept-Ranges": "bytes" },
      });
    }

    // PUT /api/file?project=<name>&path=<relPath>  — write artifact back to disk
    if (url.pathname === "/api/file" && (req.method === "PUT" || req.method === "OPTIONS")) {
      const corsWithMethods = {
        ...CORS,
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsWithMethods });
      }

      // Validate query params
      const project = url.searchParams.get("project");
      const relPath = url.searchParams.get("path");
      if (!project || !relPath) {
        return Response.json({ error: "missing project or path param" }, { status: 400, headers: corsWithMethods });
      }

      // Validate project exists
      const projectRoot = join(WORKSPACE, project);
      if (!existsSync(projectRoot)) {
        return Response.json({ error: "project not found" }, { status: 404, headers: corsWithMethods });
      }

      // Normalize and whitelist: must match output/**/*.json
      const normalized = normalize(relPath).replace(/\\/g, "/");
      if (!/^output\/.+\.json$/.test(normalized)) {
        return Response.json({ error: "path not allowed: must be under output/ and end in .json" }, { status: 403, headers: corsWithMethods });
      }

      // Safe resolve (throws on path escape)
      let abs: string;
      try {
        abs = safeResolve(projectRoot, normalized);
      } catch {
        return Response.json({ error: "path escape detected" }, { status: 403, headers: corsWithMethods });
      }

      // Parent directory must already exist
      const parentDir = join(abs, "..");
      if (!existsSync(parentDir)) {
        return Response.json({ error: "parent directory does not exist" }, { status: 404, headers: corsWithMethods });
      }

      // Read body and validate JSON
      const text = await req.text();
      try {
        JSON.parse(text);
      } catch {
        return Response.json({ error: "request body is not valid JSON" }, { status: 409, headers: corsWithMethods });
      }

      // Atomic write: tmp → rename
      const tmp = `${abs}.tmp-${Math.random().toString(36).slice(2)}`;
      try {
        await Bun.write(tmp, text);
        await rename(tmp, abs);
      } catch (err) {
        try { await unlink(tmp); } catch { /* ignore cleanup failure */ }
        return Response.json({ error: `write failed: ${String(err)}` }, { status: 500, headers: corsWithMethods });
      }

      return Response.json({ ok: true, bytes: Buffer.byteLength(text, "utf8") }, { status: 200, headers: corsWithMethods });
    }

    return Response.json({ error: "not found" }, { status: 404, headers: CORS });
  },

  websocket: {
    open(ws: ServerWebSocket<unknown>) {
      sessions.set(ws, { project: null, session: null });
      console.log("WS connected");
    },

    async message(ws: ServerWebSocket<unknown>, raw: string | Buffer) {
      let payload: { message: string; project?: string; sessionId?: string };
      try {
        payload = JSON.parse(raw as string);
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      let slot = sessions.get(ws);
      if (!slot) {
        slot = { project: null, session: null };
        sessions.set(ws, slot);
      }

      const incomingProject = payload.project ?? null;
      if (slot.session && slot.project !== incomingProject) {
        await slot.session.close();
        slot.session = null;
        slot.project = null;
      }

      if (!slot.session) {
        const session = createAgentSession(payload.project, payload.sessionId);
        slot.session = session;
        slot.project = incomingProject;
        void (async () => {
          try {
            for await (const event of session.events) {
              if (ws.readyState !== WebSocket.OPEN) break;
              ws.send(JSON.stringify(event));
            }
          } catch (err) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "error", message: String(err) }));
            }
          }
        })();
      }

      slot.session.push(payload.message);
    },

    async close(ws: ServerWebSocket<unknown>) {
      const slot = sessions.get(ws);
      if (slot?.session) {
        await slot.session.close();
      }
      sessions.delete(ws);
      console.log("WS disconnected");
    },
  },
});

console.log("API → http://localhost:3001  WS → ws://localhost:3001/ws");
