import { createAgentSession, type AgentSession } from "./src/orchestrator";
import type { ServerWebSocket } from "bun";
import { dirname, extname, join, normalize } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { mkdir, rename, rm, symlink, unlink } from "fs/promises";
import { episodePreviewPathForStoryboard, safeResolve, walkTree, mimeFor } from "./src/serverUtils";

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

const JSON_POST_CORS = {
  ...CORS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function runFfmpeg(args: string[], cwd: string): Promise<{ ok: boolean; stderr: string }> {
  const proc = Bun.spawn(["ffmpeg", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stderr };
}

function normalizedRelPath(path: string): string {
  return normalize(path).replace(/\\/g, "/").replace(/^\/+/, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

async function ensureEpisodePreview(
  projectRoot: string,
  storyboardPath: string,
  clipPaths: string[],
): Promise<{ path: string; created: boolean }> {
  const normalizedStoryboardPath = normalizedRelPath(storyboardPath);
  if (!/^output\/.+_storyboard\.json$/.test(normalizedStoryboardPath)) {
    throw new Error("storyboardPath must be an output storyboard json");
  }

  const targetRelPath = normalizedRelPath(episodePreviewPathForStoryboard(normalizedStoryboardPath));
  if (!/^output\/.+\.mp4$/.test(targetRelPath)) {
    throw new Error("episode preview path must be an output mp4");
  }

  const targetAbsPath = safeResolve(projectRoot, targetRelPath);
  if (existsSync(targetAbsPath)) {
    return { path: targetRelPath, created: false };
  }

  const sourceAbsPaths = uniqueStrings(clipPaths.map(normalizedRelPath))
    .filter((relPath) => /^output\/.+\.(?:mp4|mov|webm)$/i.test(relPath))
    .map((relPath) => safeResolve(projectRoot, relPath))
    .filter((absPath) => existsSync(absPath));

  if (sourceAbsPaths.length === 0) {
    throw new Error("no existing clip videos to concatenate");
  }

  const targetDir = dirname(targetAbsPath);
  await mkdir(targetDir, { recursive: true });
  const tempDir = join(targetDir, `.episode-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const manifestLines: string[] = [];
    for (let index = 0; index < sourceAbsPaths.length; index += 1) {
      const ext = extname(sourceAbsPaths[index]) || ".mp4";
      const linkName = `clip-${String(index + 1).padStart(4, "0")}${ext}`;
      await symlink(sourceAbsPaths[index], join(tempDir, linkName));
      manifestLines.push(`file '${linkName}'`);
    }

    await Bun.write(join(tempDir, "concat.txt"), `${manifestLines.join("\n")}\n`);
    const tempOutput = join(tempDir, "episode.mp4");

    const copyResult = await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "concat.txt",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      tempOutput,
    ], tempDir);

    if (!copyResult.ok) {
      const encodeResult = await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-fflags",
        "+genpts",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "concat.txt",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        tempOutput,
      ], tempDir);

      if (!encodeResult.ok) {
        throw new Error(`ffmpeg concat failed: ${encodeResult.stderr || copyResult.stderr}`);
      }
    }

    await rename(tempOutput, targetAbsPath);
    return { path: targetRelPath, created: true };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

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

    const episodePreviewMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/episode-preview$/);
    if (episodePreviewMatch) {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: JSON_POST_CORS });
      }

      if (req.method !== "POST") {
        return Response.json({ error: "method not allowed" }, { status: 405, headers: JSON_POST_CORS });
      }

      const projectRoot = join(WORKSPACE, decodeURIComponent(episodePreviewMatch[1]));
      if (!existsSync(projectRoot)) {
        return Response.json({ error: "project not found" }, { status: 404, headers: JSON_POST_CORS });
      }

      let payload: { storyboardPath?: unknown; clipPaths?: unknown };
      try {
        payload = await req.json();
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400, headers: JSON_POST_CORS });
      }

      if (typeof payload.storyboardPath !== "string" || !Array.isArray(payload.clipPaths)) {
        return Response.json({ error: "storyboardPath and clipPaths are required" }, { status: 400, headers: JSON_POST_CORS });
      }

      try {
        const result = await ensureEpisodePreview(
          projectRoot,
          payload.storyboardPath,
          payload.clipPaths.filter((path): path is string => typeof path === "string"),
        );
        return Response.json({ ok: true, ...result }, { headers: JSON_POST_CORS });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500, headers: JSON_POST_CORS });
      }
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
