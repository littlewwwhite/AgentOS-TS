import { createAgentSession, type AgentSession } from "./src/orchestrator";
import type { ServerWebSocket } from "bun";
import { dirname, extname, join, normalize } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { mkdir, rename, rm, symlink, unlink } from "fs/promises";
import { episodePreviewPathForStoryboard, safeResolve, walkTree, mimeFor } from "./src/serverUtils";
import { applyManualEditToPipelineState, getEditPolicy } from "./src/lib/editPolicy";
import { applyArtifactActionToPipelineState } from "./src/lib/artifactActions";
import { validateEditableArtifact } from "./src/lib/artifactValidators";
import { approvedStoryboardPathFromAnyPath } from "./src/lib/storyboardPaths";
import { buildSourceUploadTargets } from "./src/lib/sourceUpload";
import { buildProjectBootstrap } from "./src/lib/projectBootstrap";

const WORKSPACE = join(import.meta.dir, "../../workspace");
const DIST_ROOT = join(import.meta.dir, "dist");
const PORT = Number(Bun.env.PORT ?? "3001");

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

async function writeTextAtomically(absPath: string, text: string) {
  const tmp = `${absPath}.tmp-${Math.random().toString(36).slice(2)}`;
  try {
    await Bun.write(tmp, text);
    await rename(tmp, absPath);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore cleanup failure */ }
    throw err;
  }
}

async function syncApprovedStoryboard(projectRoot: string, relPath: string) {
  const approvedPath = approvedStoryboardPathFromAnyPath(relPath);
  if (!approvedPath || approvedPath === relPath) return;

  const sourceAbs = safeResolve(projectRoot, relPath);
  if (!existsSync(sourceAbs)) return;

  const targetAbs = safeResolve(projectRoot, approvedPath);
  await mkdir(dirname(targetAbs), { recursive: true });
  const text = readFileSync(sourceAbs, "utf-8");
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      data.status = "approved";
      await writeTextAtomically(targetAbs, `${JSON.stringify(data, null, 2)}\n`);
      return;
    }
  } catch {
    // Non-JSON storyboard-like artifacts are copied byte-for-byte.
  }
  await writeTextAtomically(targetAbs, text);
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

function readPipelineState(projectRoot: string) {
  const statePath = join(projectRoot, "pipeline-state.json");
  if (!existsSync(statePath)) return null;
  return {
    path: statePath,
    state: JSON.parse(readFileSync(statePath, "utf-8")),
  };
}

function shouldServeStatic(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return !pathname.startsWith("/api/") && pathname !== "/api" && !pathname.startsWith("/files/") && pathname !== "/ws";
}

function staticAssetPath(pathname: string): string | null {
  if (!existsSync(DIST_ROOT)) return null;
  const relPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  try {
    const abs = safeResolve(DIST_ROOT, relPath);
    if (existsSync(abs)) return abs;
  } catch {
    return null;
  }
  const indexPath = join(DIST_ROOT, "index.html");
  return existsSync(indexPath) ? indexPath : null;
}

Bun.serve({
  port: PORT,

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

    if (url.pathname === "/api/projects/bootstrap") {
      const corsWithMethods = {
        ...CORS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsWithMethods });
      }

      if (req.method !== "POST") {
        return Response.json({ error: "method not allowed" }, { status: 405, headers: corsWithMethods });
      }

      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return Response.json({ error: "invalid multipart form data" }, { status: 400, headers: corsWithMethods });
      }

      const projectName = form.get("projectName");
      const file = form.get("file");
      if (typeof projectName !== "string" || !(file instanceof File)) {
        return Response.json({ error: "projectName and file are required" }, { status: 400, headers: corsWithMethods });
      }

      let plan;
      try {
        plan = buildProjectBootstrap({
          projectName,
          sourceFilename: file.name,
          sourceContentType: file.type,
        });
      } catch (err) {
        return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400, headers: corsWithMethods });
      }

      const projectRoot = join(WORKSPACE, plan.projectKey);
      if (existsSync(projectRoot)) {
        return Response.json({ error: "project already exists" }, { status: 409, headers: corsWithMethods });
      }

      await mkdir(projectRoot, { recursive: true });

      try {
        const rawPath = plan.files.find((entry) => entry.kind === "raw")?.path;
        if (!rawPath) {
          throw new Error("bootstrap plan missing raw input path");
        }

        const rawAbs = safeResolve(projectRoot, rawPath);
        await mkdir(dirname(rawAbs), { recursive: true });
        await Bun.write(rawAbs, file);

        if (plan.sourceUpdated) {
          const sourceAbs = safeResolve(projectRoot, "source.txt");
          await writeTextAtomically(sourceAbs, await file.text());
        }

        const stateAbs = safeResolve(projectRoot, "pipeline-state.json");
        await writeTextAtomically(stateAbs, `${JSON.stringify(plan.initialState, null, 2)}\n`);

        return Response.json({
          ok: true,
          project: plan.projectKey,
          rawPath,
          sourcePath: plan.sourceUpdated ? "source.txt" : null,
          sourceUpdated: plan.sourceUpdated,
          currentStage: plan.initialState.current_stage,
          nextAction: plan.initialState.next_action,
        }, { status: 200, headers: corsWithMethods });
      } catch (err) {
        await rm(projectRoot, { recursive: true, force: true });
        return Response.json({ error: `bootstrap failed: ${String(err instanceof Error ? err.message : err)}` }, { status: 500, headers: corsWithMethods });
      }
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

    const sourceUploadMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/source-upload$/);
    if (sourceUploadMatch) {
      const corsWithMethods = {
        ...CORS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsWithMethods });
      }

      if (req.method !== "POST") {
        return Response.json({ error: "method not allowed" }, { status: 405, headers: corsWithMethods });
      }

      const projectRoot = join(WORKSPACE, decodeURIComponent(sourceUploadMatch[1]));
      if (!existsSync(projectRoot)) {
        return Response.json({ error: "project not found" }, { status: 404, headers: corsWithMethods });
      }

      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return Response.json({ error: "invalid multipart form data" }, { status: 400, headers: corsWithMethods });
      }

      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "missing file field" }, { status: 400, headers: corsWithMethods });
      }

      const targets = buildSourceUploadTargets(file.name, file.type);
      const stateEntry = readPipelineState(projectRoot);

      if (targets.sourcePath) {
        const sourceState = stateEntry?.state?.artifacts?.[targets.sourcePath];
        if (sourceState && (sourceState.status === "locked" || sourceState.editable === false)) {
          return Response.json(
            { error: "source artifact is locked; unlock it before replacing source.txt" },
            { status: 409, headers: corsWithMethods },
          );
        }
      }

      let rawAbs: string;
      try {
        rawAbs = safeResolve(projectRoot, targets.rawPath);
      } catch {
        return Response.json({ error: "path escape detected" }, { status: 403, headers: corsWithMethods });
      }

      await mkdir(dirname(rawAbs), { recursive: true });
      await Bun.write(rawAbs, file);

      let sourceUpdated = false;
      if (targets.sourcePath) {
        const sourceAbs = safeResolve(projectRoot, targets.sourcePath);
        await writeTextAtomically(sourceAbs, await file.text());
        sourceUpdated = true;

        if (stateEntry) {
          const nextState = applyManualEditToPipelineState(stateEntry.state, targets.sourcePath);
          await writeTextAtomically(stateEntry.path, `${JSON.stringify(nextState, null, 2)}\n`);
        }
      }

      return Response.json(
        {
          ok: true,
          rawPath: targets.rawPath,
          sourcePath: targets.sourcePath ?? null,
          sourceUpdated,
          bytes: file.size,
        },
        { status: 200, headers: corsWithMethods },
      );
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

    if (url.pathname === "/api/artifact-action" && (req.method === "POST" || req.method === "OPTIONS")) {
      const corsWithMethods = {
        ...CORS,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsWithMethods });
      }

      const project = url.searchParams.get("project");
      const relPath = url.searchParams.get("path");
      if (!project || !relPath) {
        return Response.json({ error: "missing project or path param" }, { status: 400, headers: corsWithMethods });
      }

      const projectRoot = join(WORKSPACE, project);
      if (!existsSync(projectRoot)) {
        return Response.json({ error: "project not found" }, { status: 404, headers: corsWithMethods });
      }

      const normalized = normalize(relPath).replace(/\\/g, "/");
      if (!getEditPolicy(normalized)) {
        return Response.json({ error: "path not allowed: not a legal business artifact" }, { status: 403, headers: corsWithMethods });
      }

      const stateEntry = readPipelineState(projectRoot);
      if (!stateEntry) {
        return Response.json({ error: "pipeline-state.json not found" }, { status: 409, headers: corsWithMethods });
      }

      let payload: { action?: unknown; reason?: unknown };
      try {
        payload = await req.json();
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400, headers: corsWithMethods });
      }

      if (
        payload.action !== "approve" &&
        payload.action !== "request_change" &&
        payload.action !== "lock" &&
        payload.action !== "unlock"
      ) {
        return Response.json({ error: "invalid action" }, { status: 400, headers: corsWithMethods });
      }

      if (payload.action === "request_change" && typeof payload.reason !== "string") {
        return Response.json({ error: "request_change requires reason" }, { status: 400, headers: corsWithMethods });
      }

      try {
        if (payload.action === "approve") {
          await syncApprovedStoryboard(projectRoot, normalized);
        }
        const nextState = applyArtifactActionToPipelineState(stateEntry.state, normalized, {
          action: payload.action,
          reason: typeof payload.reason === "string" ? payload.reason : undefined,
        });
        await writeTextAtomically(stateEntry.path, `${JSON.stringify(nextState, null, 2)}\n`);
        return Response.json({ ok: true }, { status: 200, headers: corsWithMethods });
      } catch (err) {
        return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 409, headers: corsWithMethods });
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

      // Normalize and check legal business edit points
      const normalized = normalize(relPath).replace(/\\/g, "/");
      const policy = getEditPolicy(normalized);
      if (!policy) {
        return Response.json({ error: "path not allowed: not a legal business edit point" }, { status: 403, headers: corsWithMethods });
      }

      const stateEntry = readPipelineState(projectRoot);
      const artifactState = stateEntry?.state?.artifacts?.[normalized];
      if (artifactState && (artifactState.status === "locked" || artifactState.editable === false)) {
        return Response.json(
          { error: "artifact is locked; unlock it before editing" },
          { status: 409, headers: corsWithMethods },
        );
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

      // Read body and validate by content kind
      const text = await req.text();
      if (policy.contentKind === "json") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return Response.json({ error: "request body is not valid JSON" }, { status: 409, headers: corsWithMethods });
        }

        const validation = validateEditableArtifact(normalized, parsed);
        if (!validation.ok) {
          return Response.json({ error: validation.error }, { status: 409, headers: corsWithMethods });
        }
      }

      const previousText = existsSync(abs) ? readFileSync(abs, "utf-8") : null;

      // Atomic write target artifact
      try {
        await writeTextAtomically(abs, text);
      } catch (err) {
        return Response.json({ error: `write failed: ${String(err)}` }, { status: 500, headers: corsWithMethods });
      }

      // Best-effort but consistency-oriented pipeline-state update
      if (stateEntry) {
        try {
          const nextState = applyManualEditToPipelineState(stateEntry.state, normalized);
          await writeTextAtomically(stateEntry.path, `${JSON.stringify(nextState, null, 2)}\n`);
        } catch (err) {
          if (previousText !== null) {
            try {
              await writeTextAtomically(abs, previousText);
            } catch {
              // ignore rollback failure; report original state-sync error
            }
          }
          return Response.json(
            { error: `state sync failed after edit: ${String(err)}` },
            { status: 500, headers: corsWithMethods },
          );
        }
      }

      return Response.json({ ok: true, bytes: Buffer.byteLength(text, "utf8") }, { status: 200, headers: corsWithMethods });
    }

    if (shouldServeStatic(url.pathname, req.method)) {
      const abs = staticAssetPath(url.pathname);
      if (abs) {
        return new Response(Bun.file(abs), {
          headers: { "Content-Type": mimeFor(abs) },
        });
      }
    }

    return Response.json({ error: "not found" }, { status: 404, headers: CORS });
  },

  websocket: {
    open(ws: ServerWebSocket<unknown>) {
      sessions.set(ws, { project: null, session: null });
      console.log("WS connected");
    },

    async message(ws: ServerWebSocket<unknown>, raw: string | Buffer) {
      let payload: { message?: string; project?: string; sessionId?: string; action?: string };
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

      if (payload.action === "interrupt") {
        await slot.session?.interrupt();
        return;
      }

      if (typeof payload.message !== "string") {
        ws.send(JSON.stringify({ type: "error", message: "Missing message" }));
        return;
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

console.log(`Console → http://localhost:${PORT}  API → http://localhost:${PORT}/api  WS → ws://localhost:${PORT}/ws`);
