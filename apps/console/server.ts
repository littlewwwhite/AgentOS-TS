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

    return Response.json({ error: "not found" }, { status: 404, headers: CORS });
  },

  websocket: {
    open(ws) {
      console.log("WS connected");
    },

    async message(ws, raw) {
      let payload: { message: string; project?: string };
      try {
        payload = JSON.parse(raw as string);
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      try {
        for await (const event of runAgent(payload.message)) {
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
