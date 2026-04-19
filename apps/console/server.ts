import { runAgent } from "./src/orchestrator";
import { join } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { safeResolve, walkTree, mimeFor } from "./src/serverUtils";

const WORKSPACE = join(import.meta.dir, "../../workspace");

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

  fetch(req, server) {
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

    return Response.json({ error: "not found" }, { status: 404, headers: CORS });
  },

  websocket: {
    open(ws) {
      console.log("WS connected");
    },

    async message(ws, raw) {
      let payload: { message: string; project?: string; sessionId?: string };
      try {
        payload = JSON.parse(raw as string);
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      try {
        for await (const event of runAgent(payload.message, payload.project, payload.sessionId)) {
          ws.send(JSON.stringify(event));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: String(err) }));
      }
    },

    close(ws) {
      console.log("WS disconnected");
    },
  },
});

console.log("API → http://localhost:3001  WS → ws://localhost:3001/ws");
