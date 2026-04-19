# Console 3-Pane Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `apps/console` as a VS Code-style 3-zone UI — pipeline-shaped navigator (left), tabbed type-aware viewer (center), chat (right) — with backend file/tree endpoints so users can browse a project's multi-type artifact tree without losing streaming chat context.

**Architecture:** Project root is `workspace/{name}/` (unchanged filesystem — outputs already live under `workspace/{name}/output/` via `${PROJECT_DIR}` convention). Backend adds read-only tree + static-file endpoints. Frontend splits into Navigator (tree rendered from `pipeline-state.json`), Viewer (tab bar + pure `resolveView` dispatch to per-type view modules), Chat (unchanged). Three independent React Contexts; WS tool-results fire weak-follow badge updates only — never steal focus or open tabs.

**Tech Stack:** Bun 1.2, React 19, TypeScript 5.8, Tailwind v4, `@anthropic-ai/claude-agent-sdk` v0.2.114. Tests via `bun test` (built-in). No new runtime dependencies.

**Reference spec:** `docs/superpowers/specs/2026-04-19-console-3pane-redesign-design.md`

---

## File Map

**Backend (Bun server):**
- Modify: `apps/console/server.ts` — add `/api/projects/{name}/tree` and `/files/{name}/*` endpoints
- Create: `apps/console/src/serverUtils.ts` — pure helpers (tree walk, MIME, safe join)
- Test: `apps/console/test/serverUtils.test.ts`

**Frontend types + pure libs:**
- Modify: `apps/console/src/types.ts` — remove `CanvasView`, add `TreeNode`, `Tab`, `ViewKind`
- Create: `apps/console/src/lib/fileUrl.ts` — build `/files/{name}/...` URLs
- Create: `apps/console/src/lib/schemaDetect.ts` — classify JSON file by shape
- Create: `apps/console/src/components/Viewer/resolveView.ts` — `(path) → ViewKind`
- Test: `apps/console/test/lib.test.ts`, `apps/console/test/resolveView.test.ts`

**Frontend state:**
- Create: `apps/console/src/contexts/ProjectContext.tsx`
- Create: `apps/console/src/contexts/TabsContext.tsx`
- Modify: `apps/console/src/hooks/useWebSocket.ts` — drop `canvas` state, emit weak-follow signal

**Frontend shell:**
- Modify: `apps/console/src/App.tsx` — 3-zone layout
- Delete: `apps/console/src/components/CanvasPane.tsx`
- Delete: `apps/console/src/components/PipelineTimeline.tsx` (content absorbed into `OverviewView`)

**Frontend navigator:**
- Create: `apps/console/src/components/Navigator/Navigator.tsx`
- Create: `apps/console/src/components/Navigator/ProjectSwitcher.tsx`
- Create: `apps/console/src/components/Navigator/StageNode.tsx`
- Create: `apps/console/src/components/Navigator/EpisodeNode.tsx`
- Modify: `apps/console/src/components/StatusBadge.tsx` — reuse if present, else create minimal

**Frontend viewer shell + views:**
- Create: `apps/console/src/components/Viewer/Viewer.tsx`
- Create: `apps/console/src/components/Viewer/TabBar.tsx`
- Create: `apps/console/src/components/Viewer/views/FallbackView.tsx`
- Create: `apps/console/src/components/Viewer/views/JsonView.tsx`
- Create: `apps/console/src/components/Viewer/views/TextView.tsx`
- Create: `apps/console/src/components/Viewer/views/ImageView.tsx`
- Create: `apps/console/src/components/Viewer/views/VideoView.tsx`
- Create: `apps/console/src/components/Viewer/views/AssetGalleryView.tsx`
- Create: `apps/console/src/components/Viewer/views/VideoGridView.tsx`
- Create: `apps/console/src/components/Viewer/views/ScriptView.tsx`
- Create: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- Create: `apps/console/src/components/Viewer/views/OverviewView.tsx`

**Frontend chat (relocation only):**
- Move: `apps/console/src/components/{ChatPane,MessageBubble,ToolCard}.tsx` → `components/Chat/`

**Docs:**
- Modify: `CLAUDE.md` §Project Layout — clarify per-project single-root convention

---

## Task Ordering

Linear dependencies enforce this order. Tasks 9–13 (view modules) are independently parallel-safe once Task 8 lands — implementer may batch them.

1. Legacy output cleanup + docs
2. Backend: server utils + tree endpoint
3. Backend: static file endpoint
4. Types + lib helpers
5. React contexts
6. App shell + chat relocation + delete CanvasPane
7. resolveView dispatch
8. Viewer shell + FallbackView
9. Simple leaf views (Json, Text, Image, Video)
10. AssetGalleryView
11. VideoGridView
12. ScriptView + StoryboardView
13. OverviewView + delete PipelineTimeline
14. Navigator
15. Weak-follow wiring
16. Final cleanup + smoke

---

## Task 1: Legacy output cleanup + docs clarification

**Files:**
- Modify: `CLAUDE.md` (§Project Layout section)
- Move: `output/c3/*` → `workspace/c3/output/*` (manual resolution if collision)

- [ ] **Step 1: Inspect legacy `output/c3/` vs existing `workspace/c3/`**

Run:
```bash
ls /Users/dingzhijian/lingjing/AgentOS-TS/output/c3/
ls /Users/dingzhijian/lingjing/AgentOS-TS/workspace/c3/ 2>/dev/null
```
Expected: top-level `output/c3/` contains `actors`, `ep001..ep005`, `locations`, `props`, `script.json`. If `workspace/c3/` does not exist, the move is clean.

- [ ] **Step 2: Move legacy output into workspace**

If `workspace/c3/` does not exist:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
mkdir -p workspace/c3
mv output/c3 workspace/c3/output
rmdir output
```
If `workspace/c3/` exists with content, abort the move, note the conflict, and ask the user.

- [ ] **Step 3: Update `CLAUDE.md` Project Layout section**

Modify the section to read (full replacement of the `## Project Layout` section):

```markdown
## Project Layout

每个项目以 `{name}` 命名（通常取源文件名或用户指定），**所有产物都落在 `workspace/{name}/` 单一根目录下**，不再使用顶层 `output/`。

```
${PROJECT_DIR}/                    ← repo root (lingjing/AgentOS-TS)
├── data/                          ← uploaded source materials
├── workspace/{name}/              ← per-project root (single source of truth)
│   ├── pipeline-state.json        ← machine-readable pipeline checkpoint
│   ├── source.txt                 ← source copy
│   ├── draft/                     ← LLM intermediates (design.json, connectivity.md, episodes/, etc.)
│   └── output/                    ← user-facing artifacts
│       ├── inspiration.json
│       ├── script.json
│       ├── actors/  locations/  props/
│       └── ep{NNN}/               ← per-episode storyboard + scn*/clip*/*.mp4
└── .claude/skills/                ← skill definitions
```

Skills 中的 `${PROJECT_DIR}` 在执行时被设置为当前项目根目录 `workspace/{name}/`，因此 `${PROJECT_DIR}/output/...` 自然落在 `workspace/{name}/output/...`。`${WORKSPACE}` 和 `${OUTPUT}` 宏已废弃 —— skills 一律使用 `${PROJECT_DIR}` 前缀。
```

- [ ] **Step 4: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add CLAUDE.md workspace/c3/ 2>/dev/null
git rm -r output/ 2>/dev/null || true
git commit -m "refactor: unify project root to workspace/{name}/ and retire top-level output/"
```

---

## Task 2: Backend — server utils + tree endpoint

**Files:**
- Create: `apps/console/src/serverUtils.ts`
- Modify: `apps/console/server.ts`
- Create: `apps/console/test/serverUtils.test.ts`

- [ ] **Step 1: Write failing test for `safeResolve` and `walkTree`**

Create `apps/console/test/serverUtils.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { safeResolve, walkTree } from "../src/serverUtils";

const FIX = "/tmp/console-serverutils-fix";

function setup() {
  rmSync(FIX, { recursive: true, force: true });
  mkdirSync(join(FIX, "a", "b"), { recursive: true });
  writeFileSync(join(FIX, "a", "b", "leaf.txt"), "hi");
  writeFileSync(join(FIX, "a", "top.json"), "{}");
  mkdirSync(join(FIX, "a", "draft"));
  writeFileSync(join(FIX, "a", "draft", "d.md"), "x");
}

describe("safeResolve", () => {
  setup();
  test("accepts path inside root", () => {
    expect(safeResolve(FIX, "a/top.json")).toBe(join(FIX, "a", "top.json"));
  });
  test("rejects traversal", () => {
    expect(() => safeResolve(FIX, "../etc/passwd")).toThrow();
  });
});

describe("walkTree", () => {
  setup();
  test("returns flat list with types", () => {
    const t = walkTree(join(FIX, "a"), { maxDepth: 2, includeDraft: false });
    const names = t.map((n) => n.path).sort();
    expect(names).toContain("top.json");
    expect(names).toContain("b");
    expect(names).toContain("b/leaf.txt");
    expect(names.some((n) => n.startsWith("draft"))).toBe(false);
  });
  test("includes draft when asked", () => {
    const t = walkTree(join(FIX, "a"), { maxDepth: 2, includeDraft: true });
    expect(t.some((n) => n.path === "draft/d.md")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bun test test/serverUtils.test.ts
```
Expected: FAIL with `Cannot find module '../src/serverUtils'`.

- [ ] **Step 3: Implement `serverUtils.ts`**

Create `apps/console/src/serverUtils.ts`:
```typescript
import { readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";

export interface TreeNode {
  path: string;           // relative to root, POSIX separators
  name: string;           // basename
  type: "dir" | "file";
  size?: number;          // bytes, files only
  mtime?: number;         // unix ms, files only
}

export function safeResolve(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const rootAbs = resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + "/")) {
    throw new Error(`path escapes root: ${rel}`);
  }
  return abs;
}

export interface WalkOptions {
  maxDepth: number;
  includeDraft: boolean;
}

export function walkTree(root: string, opts: WalkOptions): TreeNode[] {
  const out: TreeNode[] = [];
  walk(root, root, 0, opts, out);
  return out;
}

function walk(root: string, dir: string, depth: number, opts: WalkOptions, out: TreeNode[]) {
  if (depth > opts.maxDepth) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!opts.includeDraft && depth === 0 && ent.name === "draft") continue;
    if (ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    const rel = relative(root, full).split("/").join("/");
    if (ent.isDirectory()) {
      out.push({ path: rel, name: ent.name, type: "dir" });
      walk(root, full, depth + 1, opts, out);
    } else if (ent.isFile()) {
      const s = statSync(full);
      out.push({ path: rel, name: ent.name, type: "file", size: s.size, mtime: s.mtimeMs });
    }
  }
}

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

export function mimeFor(path: string): string {
  const i = path.lastIndexOf(".");
  if (i < 0) return "application/octet-stream";
  return MIME[path.slice(i).toLowerCase()] ?? "application/octet-stream";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
bun test test/serverUtils.test.ts
```
Expected: PASS, 4 passing.

- [ ] **Step 5: Wire tree endpoint into server.ts**

Modify `apps/console/server.ts`. Add import near the top:
```typescript
import { safeResolve, walkTree, mimeFor } from "./src/serverUtils";
```

Inside the `fetch` handler, add before the final `404` return:
```typescript
    // Tree: GET /api/projects/{name}/tree[?include_draft=1]
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
```

- [ ] **Step 6: Manual smoke**

Start server in background:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bun server.ts &
SERVER_PID=$!
sleep 1
curl -s http://localhost:3001/api/projects/c3-1/tree | head -c 500
kill $SERVER_PID
```
Expected: JSON array beginning with objects like `{"path":"output","name":"output","type":"dir"}`.

- [ ] **Step 7: Commit**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS
git add apps/console/src/serverUtils.ts apps/console/server.ts apps/console/test/serverUtils.test.ts
git commit -m "feat(console): add /api/projects/:name/tree endpoint"
```

---

## Task 3: Backend — static file endpoint with Range support

**Files:**
- Modify: `apps/console/server.ts`
- Extend: `apps/console/test/serverUtils.test.ts` (add mimeFor tests)

- [ ] **Step 1: Add mimeFor test**

Append to `apps/console/test/serverUtils.test.ts`:
```typescript
import { mimeFor } from "../src/serverUtils";

describe("mimeFor", () => {
  test("known extensions", () => {
    expect(mimeFor("a/b.png")).toBe("image/png");
    expect(mimeFor("foo.mp4")).toBe("video/mp4");
    expect(mimeFor("x.json")).toBe("application/json");
  });
  test("unknown defaults to octet-stream", () => {
    expect(mimeFor("x.xyz")).toBe("application/octet-stream");
    expect(mimeFor("noext")).toBe("application/octet-stream");
  });
});
```

- [ ] **Step 2: Run test to verify pass**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bun test test/serverUtils.test.ts
```
Expected: PASS, 6 passing.

- [ ] **Step 3: Add static file endpoint to server.ts**

In `apps/console/server.ts`, inside the `fetch` handler add before the final 404:
```typescript
    // Static files: GET /files/{name}/* with Range support
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
```

- [ ] **Step 4: Manual smoke**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bun server.ts &
SERVER_PID=$!
sleep 1
curl -sI http://localhost:3001/files/c3-1/output/script.json
curl -sI -H "Range: bytes=0-99" http://localhost:3001/files/c3-1/nosuch
curl -sI http://localhost:3001/files/c3-1/../../../etc/passwd
kill $SERVER_PID
```
Expected: first returns `200 OK, Content-Type: application/json`; second returns `404`; third returns `403`.

- [ ] **Step 5: Commit**

```bash
git add apps/console/server.ts apps/console/test/serverUtils.test.ts
git commit -m "feat(console): add /files/:name/* static endpoint with range support"
```

---

## Task 4: Types + lib helpers (fileUrl, schemaDetect)

**Files:**
- Modify: `apps/console/src/types.ts`
- Create: `apps/console/src/lib/fileUrl.ts`
- Create: `apps/console/src/lib/schemaDetect.ts`
- Create: `apps/console/test/lib.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/console/test/lib.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { fileUrl } from "../src/lib/fileUrl";
import { detectSchema } from "../src/lib/schemaDetect";

describe("fileUrl", () => {
  test("encodes path segments but keeps slashes", () => {
    expect(fileUrl("c3-1", "output/ep001/clip 1.mp4")).toBe(
      "/files/c3-1/output/ep001/clip%201.mp4",
    );
  });
  test("trims leading slash", () => {
    expect(fileUrl("c0", "/output/script.json")).toBe("/files/c0/output/script.json");
  });
});

describe("detectSchema", () => {
  test("script: has episodes array", () => {
    expect(detectSchema({ episodes: [{ scenes: [] }] })).toBe("script");
  });
  test("storyboard: scenes with shots+prompt", () => {
    expect(detectSchema({ episode_id: "ep001", scenes: [{ shots: [{ prompt: "x" }] }] })).toBe("storyboard");
  });
  test("inspiration: has inspiration_id or brief", () => {
    expect(detectSchema({ brief: "x", topics: [] })).toBe("inspiration");
  });
  test("fallback: unknown", () => {
    expect(detectSchema({ foo: 1 })).toBe("generic");
  });
  test("non-object returns generic", () => {
    expect(detectSchema(null)).toBe("generic");
    expect(detectSchema([1, 2])).toBe("generic");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bun test test/lib.test.ts
```
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement `fileUrl.ts`**

Create `apps/console/src/lib/fileUrl.ts`:
```typescript
export function fileUrl(projectName: string, relPath: string): string {
  const trimmed = relPath.replace(/^\/+/, "");
  const encoded = trimmed.split("/").map(encodeURIComponent).join("/");
  return `/files/${encodeURIComponent(projectName)}/${encoded}`;
}
```

- [ ] **Step 4: Implement `schemaDetect.ts`**

Create `apps/console/src/lib/schemaDetect.ts`:
```typescript
export type JsonSchemaKind = "script" | "storyboard" | "inspiration" | "pipeline-state" | "generic";

export function detectSchema(data: unknown): JsonSchemaKind {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return "generic";
  const o = data as Record<string, unknown>;
  if ("stages" in o && "episodes" in o && "current_stage" in o) return "pipeline-state";
  const firstEp = Array.isArray(o.scenes) ? (o.scenes as unknown[])[0] : undefined;
  if (firstEp && typeof firstEp === "object") {
    const shots = (firstEp as Record<string, unknown>).shots;
    if (Array.isArray(shots) && shots.some((s) => s && typeof s === "object" && "prompt" in (s as object))) {
      return "storyboard";
    }
  }
  if (Array.isArray(o.episodes) && o.episodes.length > 0) return "script";
  if ("brief" in o || "inspiration_id" in o) return "inspiration";
  return "generic";
}
```

- [ ] **Step 5: Extend `types.ts`**

Modify `apps/console/src/types.ts`. Replace the final `CanvasView` block (lines starting `// Canvas 视图类型…` through end) with:
```typescript
// Navigator tree node (from server tree endpoint)
export interface TreeNode {
  path: string;
  name: string;
  type: "dir" | "file";
  size?: number;
  mtime?: number;
}

// Viewer tab state
export type ViewKind =
  | "overview"
  | "script"
  | "storyboard"
  | "inspiration"
  | "asset-gallery"
  | "video-grid"
  | "image"
  | "video"
  | "text"
  | "json"
  | "fallback";

export interface Tab {
  id: string;           // unique
  path: string;         // project-relative; "" means project root
  title: string;        // display in tab bar
  view: ViewKind;       // resolved kind
  pinned: boolean;      // true = user-pinned; false = preview tab
}

// Weak-follow signal from WS tool_result
export interface FollowSignal {
  path: string;         // project-relative
  timestamp: number;
}
```

- [ ] **Step 6: Run tests to verify pass**

Run:
```bash
bun test test/lib.test.ts
```
Expected: PASS, 7 passing.

Run typecheck:
```bash
bunx tsc --noEmit
```
Expected: errors in `App.tsx`, `useWebSocket.ts`, `CanvasPane.tsx` referencing `CanvasView`. These are fixed in Task 6. All other files compile.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/types.ts apps/console/src/lib/ apps/console/test/lib.test.ts
git commit -m "feat(console): add fileUrl, schemaDetect, TreeNode/Tab/ViewKind types"
```

---

## Task 5: React contexts (Project, Tabs)

**Files:**
- Create: `apps/console/src/contexts/ProjectContext.tsx`
- Create: `apps/console/src/contexts/TabsContext.tsx`

- [ ] **Step 1: Implement `ProjectContext.tsx`**

Create `apps/console/src/contexts/ProjectContext.tsx`:
```typescript
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { PipelineState, TreeNode } from "../types";

interface ProjectContextValue {
  name: string | null;
  state: PipelineState | null;
  tree: TreeNode[];
  isLoading: boolean;
  setName: (name: string | null) => void;
  refresh: () => void;
}

const Ctx = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<PipelineState | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const load = useCallback(async (n: string) => {
    setIsLoading(true);
    try {
      const [s, t] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(n)}`).then((r) => r.json()),
        fetch(`/api/projects/${encodeURIComponent(n)}/tree`).then((r) => r.json()),
      ]);
      setState(s);
      setTree(Array.isArray(t) ? t : []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!name) {
      setState(null);
      setTree([]);
      return;
    }
    load(name);
  }, [name, load]);

  const refresh = useCallback(() => {
    if (!name) return;
    if (debounceRef.current !== undefined) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => load(name), 500);
  }, [name, load]);

  const value = useMemo(() => ({ name, state, tree, isLoading, setName, refresh }), [name, state, tree, isLoading, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProject(): ProjectContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject must be inside ProjectProvider");
  return v;
}
```

- [ ] **Step 2: Implement `TabsContext.tsx`**

Create `apps/console/src/contexts/TabsContext.tsx`:
```typescript
import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";
import type { Tab, ViewKind } from "../types";

interface OpenOpts {
  pinned?: boolean;
}

interface TabsContextValue {
  tabs: Tab[];
  activeId: string | null;
  openPath: (path: string, view: ViewKind, title: string, opts?: OpenOpts) => void;
  pinActive: () => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
}

const Ctx = createContext<TabsContextValue | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const openPath = useCallback((path: string, view: ViewKind, title: string, opts: OpenOpts = {}) => {
    const pinned = opts.pinned ?? false;
    setTabs((prev) => {
      const existing = prev.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        if (pinned && !existing.pinned) {
          return prev.map((t) => (t.id === existing.id ? { ...t, pinned: true } : t));
        }
        return prev;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next: Tab = { id, path, title, view, pinned };
      // Replace existing unpinned preview tab when new tab is also unpinned
      if (!pinned) {
        const previewIdx = prev.findIndex((t) => !t.pinned);
        if (previewIdx >= 0) {
          const copy = [...prev];
          copy[previewIdx] = next;
          setActiveId(id);
          return copy;
        }
      }
      setActiveId(id);
      return [...prev, next];
    });
  }, []);

  const pinActive = useCallback(() => {
    setTabs((prev) => prev.map((t) => (t.id === activeId ? { ...t, pinned: true } : t)));
  }, [activeId]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        setActiveId(fallback?.id ?? null);
      }
      return next;
    });
  }, [activeId]);

  const activate = useCallback((id: string) => setActiveId(id), []);

  const value = useMemo(() => ({ tabs, activeId, openPath, pinActive, closeTab, activate }),
    [tabs, activeId, openPath, pinActive, closeTab, activate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabs(): TabsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTabs must be inside TabsProvider");
  return v;
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bunx tsc --noEmit 2>&1 | grep -v "App.tsx\|useWebSocket.ts\|CanvasPane.tsx" | head
```
Expected: no errors outside the known CanvasView-dependent files (those are fixed in Task 6).

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/contexts/
git commit -m "feat(console): add ProjectContext and TabsContext"
```

---

## Task 6: App shell + chat relocation + delete CanvasPane

**Files:**
- Modify: `apps/console/src/App.tsx`
- Modify: `apps/console/src/hooks/useWebSocket.ts` (minimal: drop `canvas` return field, keep events intact)
- Move: `apps/console/src/components/{ChatPane,MessageBubble,ToolCard}.tsx` → `apps/console/src/components/Chat/`
- Delete: `apps/console/src/components/CanvasPane.tsx`

- [ ] **Step 1: Create Chat subfolder and move files**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console/src/components
mkdir -p Chat
git mv ChatPane.tsx Chat/ChatPane.tsx
git mv MessageBubble.tsx Chat/MessageBubble.tsx
git mv ToolCard.tsx Chat/ToolCard.tsx
```

Update imports inside `Chat/ChatPane.tsx`: change `./MessageBubble` to `./MessageBubble` (no change needed; relative import remains valid). Verify by grepping:
```bash
grep -n "MessageBubble\|ToolCard" Chat/ChatPane.tsx Chat/MessageBubble.tsx
```

- [ ] **Step 2: Drop canvas from useWebSocket**

Modify `apps/console/src/hooks/useWebSocket.ts`:
- Remove the `import type { …, CanvasView }` and any `canvas` state and `routeCanvas` helper.
- Change the returned object to omit `canvas`. The hook now returns `{ messages, isConnected, isStreaming, send }`.
- Leave the tool_result/text/result handling intact (messages still update).

Concrete change: delete the lines that maintain `canvas` state and the `routeCanvas` function. The file should no longer reference `CanvasView`.

Run:
```bash
grep -n "canvas\|CanvasView\|routeCanvas" apps/console/src/hooks/useWebSocket.ts
```
Expected: no matches.

- [ ] **Step 3: Delete CanvasPane**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
git rm src/components/CanvasPane.tsx
```

- [ ] **Step 4: Rewrite App.tsx as 3-zone shell**

Replace `apps/console/src/App.tsx` with:
```typescript
import { useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { ChatPane } from "./components/Chat/ChatPane";
import { ProjectProvider, useProject } from "./contexts/ProjectContext";
import { TabsProvider } from "./contexts/TabsContext";
import { ProjectSwitcher } from "./components/Navigator/ProjectSwitcher";

const WS_URL = "ws://localhost:3001/ws";

function Shell() {
  const { name, setName } = useProject();
  const { messages, isConnected, isStreaming, send } = useWebSocket(WS_URL);

  function handleSend(message: string) {
    send(message, name ?? undefined);
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center gap-4 px-5 py-3 border-b border-[oklch(20%_0_0)]">
        <span className="text-sm font-semibold text-[oklch(65%_0.18_270)]">AgentOS</span>
        <ProjectSwitcher selected={name} onSelect={setName} />
        <div className="ml-auto flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: isConnected ? "oklch(70% 0.18 145)" : "oklch(42% 0 0)" }}
          />
          <span className="text-[11px] text-[oklch(42%_0_0)]">
            {isConnected ? "已连接" : "连接中"}
          </span>
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[260px] shrink-0 border-r border-[oklch(20%_0_0)] flex flex-col overflow-hidden">
          <div className="p-3 text-[11px] text-[oklch(42%_0_0)]">Navigator — 待实现</div>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="p-3 text-[11px] text-[oklch(42%_0_0)]">Viewer — 待实现</div>
        </div>
        <div className="w-[380px] shrink-0 border-l border-[oklch(20%_0_0)] flex flex-col overflow-hidden">
          <ChatPane messages={messages} isStreaming={isStreaming} isConnected={isConnected} onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ProjectProvider>
      <TabsProvider>
        <Shell />
      </TabsProvider>
    </ProjectProvider>
  );
}
```

- [ ] **Step 5: Create placeholder ProjectSwitcher**

Create `apps/console/src/components/Navigator/ProjectSwitcher.tsx`:
```typescript
import { useEffect, useState } from "react";
import type { Project } from "../../types";

interface Props {
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function ProjectSwitcher({ selected, onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((data) => setProjects(Array.isArray(data) ? data : []));
  }, []);
  return (
    <select
      value={selected ?? ""}
      onChange={(e) => onSelect(e.target.value || null)}
      className="bg-transparent border border-[oklch(20%_0_0)] rounded px-2 py-1 text-[12px] text-[oklch(75%_0_0)]"
    >
      <option value="">选择项目</option>
      {projects.map((p) => (
        <option key={p.name} value={p.name}>{p.name}</option>
      ))}
    </select>
  );
}
```

If an existing `ProjectSelector.tsx` is referenced anywhere, delete the old file after this step — grep to find consumers:
```bash
grep -rn "ProjectSelector" apps/console/src
```

- [ ] **Step 6: Update vite to proxy /api and /files to server**

Modify `apps/console/vite.config.ts` to proxy API + files to Bun server:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/files": "http://localhost:3001",
    },
  },
});
```

- [ ] **Step 7: Typecheck + smoke**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bunx tsc --noEmit
```
Expected: no errors.

Manual smoke:
```bash
bun run dev &
sleep 2
curl -sI http://localhost:5173/ | head -1
# open browser manually to http://localhost:5173 and confirm 3-zone layout + project dropdown populates
kill %1
```

- [ ] **Step 8: Commit**

```bash
git add apps/console/src/App.tsx apps/console/src/hooks/useWebSocket.ts apps/console/src/components/ apps/console/vite.config.ts
git commit -m "feat(console): 3-zone shell; move chat to right; delete CanvasPane"
```

---

## Task 7: resolveView dispatch

**Files:**
- Create: `apps/console/src/components/Viewer/resolveView.ts`
- Create: `apps/console/test/resolveView.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/console/test/resolveView.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { resolveView } from "../src/components/Viewer/resolveView";

describe("resolveView", () => {
  test("empty path → overview", () => {
    expect(resolveView("")).toBe("overview");
  });
  test("script.json → script (by path heuristic)", () => {
    expect(resolveView("output/script.json")).toBe("script");
  });
  test("storyboard.json → storyboard", () => {
    expect(resolveView("output/ep001/ep001_storyboard.json")).toBe("storyboard");
  });
  test("inspiration.json → inspiration", () => {
    expect(resolveView("output/inspiration.json")).toBe("inspiration");
  });
  test("actors/ dir → asset-gallery", () => {
    expect(resolveView("output/actors")).toBe("asset-gallery");
    expect(resolveView("output/locations")).toBe("asset-gallery");
    expect(resolveView("output/props")).toBe("asset-gallery");
  });
  test("ep001/ dir → video-grid", () => {
    expect(resolveView("output/ep001")).toBe("video-grid");
  });
  test("mp4 leaf → video", () => {
    expect(resolveView("output/ep001/scn001/clip001/v1.mp4")).toBe("video");
  });
  test("png leaf → image", () => {
    expect(resolveView("output/actors/hero/ref.png")).toBe("image");
  });
  test("srt → text", () => {
    expect(resolveView("output/ep001/subtitles.srt")).toBe("text");
  });
  test("unknown json → json", () => {
    expect(resolveView("foo.json")).toBe("json");
  });
  test("unknown → fallback", () => {
    expect(resolveView("random.xyz")).toBe("fallback");
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bun test test/resolveView.test.ts
```
Expected: FAIL with missing module.

- [ ] **Step 3: Implement `resolveView.ts`**

Create `apps/console/src/components/Viewer/resolveView.ts`:
```typescript
import type { ViewKind } from "../../types";

export function resolveView(path: string): ViewKind {
  if (!path) return "overview";
  const base = path.split("/").pop() ?? "";
  const dotIdx = base.lastIndexOf(".");
  const ext = dotIdx >= 0 ? base.slice(dotIdx).toLowerCase() : "";

  // Leaf files by extension
  if (ext === ".mp4" || ext === ".webm" || ext === ".mov") return "video";
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp" || ext === ".gif") return "image";
  if (ext === ".srt" || ext === ".txt" || ext === ".md") return "text";
  if (ext === ".json") {
    if (base === "script.json") return "script";
    if (base.endsWith("storyboard.json")) return "storyboard";
    if (base === "inspiration.json") return "inspiration";
    return "json";
  }

  // Directory-like paths (no extension)
  const segments = path.split("/");
  const last = segments[segments.length - 1];
  if (last === "actors" || last === "locations" || last === "props") return "asset-gallery";
  if (/^ep\d+$/.test(last)) return "video-grid";
  if (last === "raw" || last === "edited" || last === "scored" || last === "final") return "video-grid";

  return "fallback";
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
bun test test/resolveView.test.ts
```
Expected: PASS, 11 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/Viewer/resolveView.ts apps/console/test/resolveView.test.ts
git commit -m "feat(console): resolveView dispatch (path → ViewKind)"
```

---

## Task 8: Viewer shell + FallbackView

**Files:**
- Create: `apps/console/src/components/Viewer/Viewer.tsx`
- Create: `apps/console/src/components/Viewer/TabBar.tsx`
- Create: `apps/console/src/components/Viewer/views/FallbackView.tsx`
- Modify: `apps/console/src/App.tsx` (swap placeholder for Viewer)

- [ ] **Step 1: Implement `FallbackView.tsx`**

Create `apps/console/src/components/Viewer/views/FallbackView.tsx`:
```typescript
interface Props {
  projectName: string;
  path: string;
}

export function FallbackView({ projectName, path }: Props) {
  return (
    <div className="p-6 text-[oklch(55%_0_0)] text-sm">
      <div className="font-semibold text-[oklch(75%_0_0)] mb-2">无可用渲染</div>
      <div className="text-xs">项目：{projectName}</div>
      <div className="text-xs">路径：{path || "(root)"}</div>
      <div className="mt-4 text-xs">此节点类型尚未配备视图组件。</div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `TabBar.tsx`**

Create `apps/console/src/components/Viewer/TabBar.tsx`:
```typescript
import { useTabs } from "../../contexts/TabsContext";

export function TabBar() {
  const { tabs, activeId, activate, closeTab } = useTabs();
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-center gap-0 border-b border-[oklch(20%_0_0)] overflow-x-auto shrink-0">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div
            key={t.id}
            onClick={() => activate(t.id)}
            className={
              "flex items-center gap-2 px-3 py-2 text-[12px] border-r border-[oklch(20%_0_0)] cursor-pointer whitespace-nowrap " +
              (active ? "bg-[oklch(18%_0_0)] text-[oklch(85%_0_0)]" : "text-[oklch(55%_0_0)] hover:text-[oklch(75%_0_0)]")
            }
          >
            <span className={t.pinned ? "" : "italic"}>{t.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              className="text-[oklch(42%_0_0)] hover:text-[oklch(75%_0_0)]"
              aria-label="关闭"
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Implement `Viewer.tsx`**

Create `apps/console/src/components/Viewer/Viewer.tsx`:
```typescript
import { useTabs } from "../../contexts/TabsContext";
import { useProject } from "../../contexts/ProjectContext";
import { TabBar } from "./TabBar";
import { FallbackView } from "./views/FallbackView";

export function Viewer() {
  const { tabs, activeId } = useTabs();
  const { name } = useProject();
  const active = tabs.find((t) => t.id === activeId);

  if (!name) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[oklch(42%_0_0)]">
        请从顶部选择项目
      </div>
    );
  }
  if (!active) {
    return (
      <div className="h-full flex flex-col">
        <TabBar />
        <div className="flex-1 flex items-center justify-center text-sm text-[oklch(42%_0_0)]">
          在左侧导航中单击节点以查看内容
        </div>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col">
      <TabBar />
      <div className="flex-1 overflow-auto">
        <FallbackView projectName={name} path={active.path} />
      </div>
    </div>
  );
}
```

Note: This task wires every `ViewKind` to `FallbackView`. Later tasks replace the switch as views are added.

- [ ] **Step 4: Mount Viewer in App.tsx**

In `apps/console/src/App.tsx`, replace the middle placeholder:
```typescript
        <div className="flex-1 overflow-hidden">
          <div className="p-3 text-[11px] text-[oklch(42%_0_0)]">Viewer — 待实现</div>
        </div>
```
with:
```typescript
        <div className="flex-1 overflow-hidden">
          <Viewer />
        </div>
```
and add the import:
```typescript
import { Viewer } from "./components/Viewer/Viewer";
```

- [ ] **Step 5: Typecheck + smoke**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bunx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/Viewer/ apps/console/src/App.tsx
git commit -m "feat(console): Viewer shell + TabBar + FallbackView"
```

---

## Task 9: Simple leaf views (Json, Text, Image, Video)

**Files:**
- Create: `apps/console/src/components/Viewer/views/JsonView.tsx`
- Create: `apps/console/src/components/Viewer/views/TextView.tsx`
- Create: `apps/console/src/components/Viewer/views/ImageView.tsx`
- Create: `apps/console/src/components/Viewer/views/VideoView.tsx`
- Create: `apps/console/src/hooks/useFile.ts`
- Modify: `apps/console/src/components/Viewer/Viewer.tsx` (dispatch map)

- [ ] **Step 1: Implement `useFile.ts`**

Create `apps/console/src/hooks/useFile.ts`:
```typescript
import { useEffect, useState } from "react";
import { fileUrl } from "../lib/fileUrl";

export function useFileText(projectName: string, relPath: string) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    fetch(fileUrl(projectName, relPath))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [projectName, relPath]);
  return { text, error };
}

export function useFileJson<T = unknown>(projectName: string, relPath: string) {
  const { text, error } = useFileText(projectName, relPath);
  const data = text != null ? safeParse<T>(text) : null;
  return { data, error: error ?? (text != null && data === null ? "invalid JSON" : null) };
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}
```

- [ ] **Step 2: Implement `TextView.tsx`**

Create `apps/console/src/components/Viewer/views/TextView.tsx`:
```typescript
import { useFileText } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

export function TextView({ projectName, path }: Props) {
  const { text, error } = useFileText(projectName, path);
  if (error) return <div className="p-4 text-red-400 text-sm">加载失败：{error}</div>;
  if (text == null) return <div className="p-4 text-[oklch(42%_0_0)] text-sm">加载中…</div>;
  return <pre className="p-4 text-[12px] text-[oklch(75%_0_0)] font-mono whitespace-pre-wrap break-words">{text}</pre>;
}
```

- [ ] **Step 3: Implement `JsonView.tsx`**

Create `apps/console/src/components/Viewer/views/JsonView.tsx`:
```typescript
import { useFileText } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

export function JsonView({ projectName, path }: Props) {
  const { text, error } = useFileText(projectName, path);
  if (error) return <div className="p-4 text-red-400 text-sm">加载失败：{error}</div>;
  if (text == null) return <div className="p-4 text-[oklch(42%_0_0)] text-sm">加载中…</div>;
  let pretty: string;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); }
  catch { pretty = text; }
  return <pre className="p-4 text-[12px] text-[oklch(75%_0_0)] font-mono whitespace-pre-wrap">{pretty}</pre>;
}
```

- [ ] **Step 4: Implement `ImageView.tsx`**

Create `apps/console/src/components/Viewer/views/ImageView.tsx`:
```typescript
import { fileUrl } from "../../../lib/fileUrl";

interface Props { projectName: string; path: string; }

export function ImageView({ projectName, path }: Props) {
  return (
    <div className="h-full flex items-center justify-center bg-[oklch(10%_0_0)] p-4">
      <img
        src={fileUrl(projectName, path)}
        alt={path}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}
```

- [ ] **Step 5: Implement `VideoView.tsx`**

Create `apps/console/src/components/Viewer/views/VideoView.tsx`:
```typescript
import { fileUrl } from "../../../lib/fileUrl";

interface Props { projectName: string; path: string; }

export function VideoView({ projectName, path }: Props) {
  return (
    <div className="h-full flex items-center justify-center bg-black p-4">
      <video src={fileUrl(projectName, path)} controls preload="metadata" className="max-w-full max-h-full" />
    </div>
  );
}
```

- [ ] **Step 6: Wire dispatch in `Viewer.tsx`**

Modify `apps/console/src/components/Viewer/Viewer.tsx` — replace the single `<FallbackView .../>` call with a dispatch. Full updated file:
```typescript
import { useTabs } from "../../contexts/TabsContext";
import { useProject } from "../../contexts/ProjectContext";
import { TabBar } from "./TabBar";
import { FallbackView } from "./views/FallbackView";
import { JsonView } from "./views/JsonView";
import { TextView } from "./views/TextView";
import { ImageView } from "./views/ImageView";
import { VideoView } from "./views/VideoView";
import type { ViewKind } from "../../types";

function renderView(kind: ViewKind, projectName: string, path: string) {
  switch (kind) {
    case "json": return <JsonView projectName={projectName} path={path} />;
    case "text": return <TextView projectName={projectName} path={path} />;
    case "image": return <ImageView projectName={projectName} path={path} />;
    case "video": return <VideoView projectName={projectName} path={path} />;
    default: return <FallbackView projectName={projectName} path={path} />;
  }
}

export function Viewer() {
  const { tabs, activeId } = useTabs();
  const { name } = useProject();
  const active = tabs.find((t) => t.id === activeId);
  if (!name) return <div className="h-full flex items-center justify-center text-sm text-[oklch(42%_0_0)]">请从顶部选择项目</div>;
  if (!active) return (
    <div className="h-full flex flex-col">
      <TabBar />
      <div className="flex-1 flex items-center justify-center text-sm text-[oklch(42%_0_0)]">在左侧导航中单击节点以查看内容</div>
    </div>
  );
  return (
    <div className="h-full flex flex-col">
      <TabBar />
      <div className="flex-1 overflow-auto">
        {renderView(active.view, name, active.path)}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bunx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/console/src/components/Viewer/ apps/console/src/hooks/useFile.ts
git commit -m "feat(console): Json/Text/Image/Video leaf views + useFile hook"
```

---

## Task 10: AssetGalleryView

**Files:**
- Create: `apps/console/src/components/Viewer/views/AssetGalleryView.tsx`
- Modify: `apps/console/src/components/Viewer/Viewer.tsx` (add dispatch)

- [ ] **Step 1: Implement `AssetGalleryView.tsx`**

Create `apps/console/src/components/Viewer/views/AssetGalleryView.tsx`:
```typescript
import { useMemo, useState } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { fileUrl } from "../../../lib/fileUrl";
import type { TreeNode } from "../../../types";

interface Props { projectName: string; path: string; }

interface Group {
  id: string;
  files: TreeNode[];
}

function isImage(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

export function AssetGalleryView({ projectName, path }: Props) {
  const { tree } = useProject();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const groups: Group[] = useMemo(() => {
    const prefix = path.endsWith("/") ? path : path + "/";
    const byGroup = new Map<string, TreeNode[]>();
    for (const node of tree) {
      if (node.type !== "file") continue;
      if (!node.path.startsWith(prefix)) continue;
      if (!isImage(node.name)) continue;
      const rel = node.path.slice(prefix.length);
      const group = rel.split("/")[0] ?? "(root)";
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(node);
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, files]) => ({ id, files: files.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [tree, path]);

  if (groups.length === 0) {
    return <div className="p-6 text-sm text-[oklch(42%_0_0)]">未发现图片资产</div>;
  }
  void projectName;

  return (
    <div className="p-4 space-y-6">
      {groups.map((g) => (
        <div key={g.id}>
          <div className="text-[12px] text-[oklch(55%_0_0)] mb-2">{g.id} · {g.files.length}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
            {g.files.map((f) => (
              <button
                key={f.path}
                onClick={() => setLightbox(f.path)}
                className="aspect-square overflow-hidden rounded bg-[oklch(14%_0_0)] hover:ring-1 hover:ring-[oklch(65%_0.18_270)]"
              >
                <img src={fileUrl(projectName, f.path)} alt={f.name} className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 cursor-zoom-out"
        >
          <img src={fileUrl(projectName, lightbox)} alt="" className="max-w-[90vw] max-h-[90vh] object-contain" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add to dispatch in Viewer.tsx**

Add import and case:
```typescript
import { AssetGalleryView } from "./views/AssetGalleryView";
// in renderView switch:
    case "asset-gallery": return <AssetGalleryView projectName={projectName} path={path} />;
```

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/Viewer/
git commit -m "feat(console): AssetGalleryView with grouping + lightbox"
```

---

## Task 11: VideoGridView

**Files:**
- Create: `apps/console/src/components/Viewer/views/VideoGridView.tsx`
- Modify: `apps/console/src/components/Viewer/Viewer.tsx` (add dispatch)

- [ ] **Step 1: Implement `VideoGridView.tsx`**

Create `apps/console/src/components/Viewer/views/VideoGridView.tsx`:
```typescript
import { useMemo, useState } from "react";
import { useProject } from "../../../contexts/ProjectContext";
import { fileUrl } from "../../../lib/fileUrl";
import type { TreeNode } from "../../../types";

interface Props { projectName: string; path: string; }

function isVideo(name: string): boolean {
  return /\.(mp4|webm|mov)$/i.test(name);
}

export function VideoGridView({ projectName, path }: Props) {
  const { tree } = useProject();
  const [lightbox, setLightbox] = useState<string | null>(null);

  const videos: TreeNode[] = useMemo(() => {
    const prefix = path.endsWith("/") ? path : path + "/";
    return tree
      .filter((n) => n.type === "file" && isVideo(n.name) && n.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [tree, path]);

  if (videos.length === 0) {
    return <div className="p-6 text-sm text-[oklch(42%_0_0)]">未发现视频文件</div>;
  }

  return (
    <div className="p-4">
      <div className="text-[12px] text-[oklch(55%_0_0)] mb-2">{videos.length} 个视频</div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {videos.map((v) => (
          <button
            key={v.path}
            onClick={() => setLightbox(v.path)}
            className="aspect-video rounded overflow-hidden bg-black hover:ring-1 hover:ring-[oklch(65%_0.18_270)] text-left"
          >
            <video src={fileUrl(projectName, v.path) + "#t=0.5"} preload="metadata" muted className="w-full h-full object-cover" />
            <div className="px-2 py-1 text-[11px] text-[oklch(55%_0_0)] truncate">{v.path}</div>
          </button>
        ))}
      </div>
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 cursor-zoom-out p-8"
        >
          <video
            src={fileUrl(projectName, lightbox)}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add dispatch case**

In `Viewer.tsx`, add import and case:
```typescript
import { VideoGridView } from "./views/VideoGridView";
// in renderView switch:
    case "video-grid": return <VideoGridView projectName={projectName} path={path} />;
```

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/components/Viewer/
git commit -m "feat(console): VideoGridView with first-frame posters + lightbox"
```

---

## Task 12: ScriptView + StoryboardView

**Files:**
- Create: `apps/console/src/components/Viewer/views/ScriptView.tsx`
- Create: `apps/console/src/components/Viewer/views/StoryboardView.tsx`
- Modify: `apps/console/src/components/Viewer/Viewer.tsx` (dispatch)

- [ ] **Step 1: Implement `ScriptView.tsx`**

Create `apps/console/src/components/Viewer/views/ScriptView.tsx`:
```typescript
import { useState } from "react";
import { useFileJson } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Shot { shot_id?: string; prompt?: string; duration?: number; }
interface Scene { scene_id?: string; title?: string; shots?: Shot[]; }
interface Episode { episode_id?: string; title?: string; logline?: string; scenes?: Scene[]; }
interface Script { title?: string; episodes?: Episode[]; }

export function ScriptView({ projectName, path }: Props) {
  const { data, error } = useFileJson<Script>(projectName, path);
  const [openEp, setOpenEp] = useState<string | null>(null);
  if (error) return <div className="p-4 text-red-400 text-sm">加载失败：{error}</div>;
  if (!data) return <div className="p-4 text-[oklch(42%_0_0)] text-sm">加载中…</div>;
  const eps = data.episodes ?? [];
  return (
    <div className="p-4 space-y-3">
      {data.title && <h2 className="text-lg font-semibold text-[oklch(85%_0_0)]">{data.title}</h2>}
      <div className="text-[12px] text-[oklch(55%_0_0)]">{eps.length} 集</div>
      <div className="space-y-2">
        {eps.map((ep, i) => {
          const id = ep.episode_id ?? `ep${i + 1}`;
          const open = openEp === id;
          const scenes = ep.scenes ?? [];
          const shotCount = scenes.reduce((s, sc) => s + (sc.shots?.length ?? 0), 0);
          return (
            <div key={id} className="border border-[oklch(20%_0_0)] rounded">
              <button
                onClick={() => setOpenEp(open ? null : id)}
                className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-[oklch(14%_0_0)]"
              >
                <span className="text-[oklch(65%_0.18_270)] text-[12px]">{open ? "▾" : "▸"}</span>
                <span className="text-[13px] text-[oklch(85%_0_0)]">{id}</span>
                {ep.title && <span className="text-[12px] text-[oklch(55%_0_0)]">· {ep.title}</span>}
                <span className="ml-auto text-[11px] text-[oklch(42%_0_0)]">{scenes.length} 场景 · {shotCount} 镜头</span>
              </button>
              {open && (
                <div className="px-4 pb-3 text-[12px] text-[oklch(65%_0_0)] space-y-2">
                  {ep.logline && <p className="italic">{ep.logline}</p>}
                  {scenes.map((sc, j) => (
                    <div key={sc.scene_id ?? j} className="pl-2 border-l border-[oklch(20%_0_0)]">
                      <div className="text-[oklch(75%_0_0)]">{sc.scene_id ?? `scn${j + 1}`}{sc.title ? ` · ${sc.title}` : ""}</div>
                      <div className="text-[11px] text-[oklch(42%_0_0)]">{sc.shots?.length ?? 0} 镜头</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `StoryboardView.tsx`**

Create `apps/console/src/components/Viewer/views/StoryboardView.tsx`:
```typescript
import { useFileJson } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Shot { shot_id?: string; prompt?: string; duration?: number; }
interface Scene { scene_id?: string; title?: string; shots?: Shot[]; }
interface Storyboard { episode_id?: string; title?: string; scenes?: Scene[]; }

export function StoryboardView({ projectName, path }: Props) {
  const { data, error } = useFileJson<Storyboard>(projectName, path);
  if (error) return <div className="p-4 text-red-400 text-sm">加载失败：{error}</div>;
  if (!data) return <div className="p-4 text-[oklch(42%_0_0)] text-sm">加载中…</div>;
  const scenes = data.scenes ?? [];
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[oklch(85%_0_0)]">{data.episode_id ?? "分镜"}</h2>
        {data.title && <div className="text-[12px] text-[oklch(55%_0_0)]">{data.title}</div>}
      </div>
      {scenes.map((sc, si) => (
        <div key={sc.scene_id ?? si} className="space-y-2">
          <div className="text-[13px] text-[oklch(75%_0_0)]">
            {sc.scene_id ?? `scn${si + 1}`}{sc.title ? ` · ${sc.title}` : ""}
          </div>
          <div className="pl-3 border-l border-[oklch(20%_0_0)] space-y-2">
            {(sc.shots ?? []).map((sh, i) => (
              <div key={sh.shot_id ?? i} className="text-[12px]">
                <div className="text-[oklch(65%_0.18_270)]">{sh.shot_id ?? `shot${i + 1}`}{sh.duration != null ? ` · ${sh.duration}s` : ""}</div>
                {sh.prompt && <div className="text-[oklch(65%_0_0)] mt-1 whitespace-pre-wrap">{sh.prompt}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire dispatch**

In `Viewer.tsx`:
```typescript
import { ScriptView } from "./views/ScriptView";
import { StoryboardView } from "./views/StoryboardView";
// in renderView switch:
    case "script": return <ScriptView projectName={projectName} path={path} />;
    case "storyboard": return <StoryboardView projectName={projectName} path={path} />;
```

Also map "inspiration" to JsonView for now (no dedicated view this iteration):
```typescript
    case "inspiration": return <JsonView projectName={projectName} path={path} />;
```

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/Viewer/
git commit -m "feat(console): ScriptView and StoryboardView"
```

---

## Task 13: OverviewView + delete PipelineTimeline

**Files:**
- Create: `apps/console/src/components/Viewer/views/OverviewView.tsx`
- Delete: `apps/console/src/components/PipelineTimeline.tsx`
- Delete: `apps/console/src/components/StageCard.tsx` (no longer referenced)
- Modify: `apps/console/src/components/Viewer/Viewer.tsx` (dispatch)

- [ ] **Step 1: Implement `OverviewView.tsx`**

Create `apps/console/src/components/Viewer/views/OverviewView.tsx`:
```typescript
import { useProject } from "../../../contexts/ProjectContext";

const STAGES = ["INSPIRATION", "SCRIPT", "VISUAL", "STORYBOARD", "VIDEO", "EDITING", "MUSIC", "SUBTITLE"] as const;

const COLOR: Record<string, string> = {
  completed: "oklch(70% 0.18 145)",
  validated: "oklch(70% 0.18 145)",
  running: "oklch(75% 0.18 260)",
  partial: "oklch(78% 0.18 80)",
  failed: "oklch(65% 0.22 25)",
  not_started: "oklch(30% 0 0)",
};

export function OverviewView() {
  const { name, state, tree } = useProject();
  if (!name) return null;
  if (!state) return <div className="p-4 text-sm text-[oklch(42%_0_0)]">加载中…</div>;

  const epCount = Object.keys(state.episodes ?? {}).length;
  const assetCount = tree.filter((n) => n.type === "file" && /^output\/(actors|locations|props)/.test(n.path)).length;
  const videoCount = tree.filter((n) => n.type === "file" && /\.(mp4|webm|mov)$/i.test(n.name)).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[oklch(85%_0_0)]">{name}</h1>
        <div className="text-[12px] text-[oklch(55%_0_0)] mt-1">
          当前阶段 {state.current_stage} · 下一步 {state.next_action}
        </div>
        {state.last_error && <div className="text-[12px] text-red-400 mt-1">上次错误：{state.last_error}</div>}
      </div>
      <div>
        <div className="text-[12px] text-[oklch(55%_0_0)] mb-2">阶段状态</div>
        <table className="w-full text-[12px]">
          <tbody>
            {STAGES.map((s) => {
              const status = state.stages?.[s]?.status ?? "not_started";
              const artifacts = state.stages?.[s]?.artifacts ?? [];
              return (
                <tr key={s} className="border-t border-[oklch(20%_0_0)]">
                  <td className="py-2 text-[oklch(75%_0_0)] w-40">{s}</td>
                  <td className="py-2">
                    <span
                      className="px-2 py-0.5 rounded text-[11px]"
                      style={{ color: COLOR[status] ?? "inherit", backgroundColor: "oklch(14% 0 0)" }}
                    >{status}</span>
                  </td>
                  <td className="py-2 text-[oklch(42%_0_0)]">{artifacts.length} 产物</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-3 gap-4 text-[12px]">
        <Stat label="集数" value={epCount} />
        <Stat label="资产图片" value={assetCount} />
        <Stat label="视频文件" value={videoCount} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[oklch(20%_0_0)] rounded p-3">
      <div className="text-[oklch(55%_0_0)]">{label}</div>
      <div className="text-2xl text-[oklch(85%_0_0)] font-semibold">{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Delete obsoleted files**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
git rm src/components/PipelineTimeline.tsx src/components/StageCard.tsx 2>/dev/null || rm -f src/components/PipelineTimeline.tsx src/components/StageCard.tsx
```

- [ ] **Step 3: Wire dispatch**

In `Viewer.tsx`:
```typescript
import { OverviewView } from "./views/OverviewView";
// in renderView switch:
    case "overview": return <OverviewView />;
```

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit
```
Expected: no errors. If errors reference `PipelineTimeline` or `StageCard`, grep and delete stale imports.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/
git commit -m "feat(console): OverviewView (absorbs PipelineTimeline); remove StageCard"
```

---

## Task 14: Navigator

**Files:**
- Create: `apps/console/src/components/Navigator/Navigator.tsx`
- Create: `apps/console/src/components/Navigator/StageNode.tsx`
- Create: `apps/console/src/components/Navigator/EpisodeNode.tsx`
- Create: `apps/console/src/components/Navigator/StatusBadge.tsx` (if not existing; if existing, reuse unchanged)
- Modify: `apps/console/src/App.tsx` (mount Navigator)

- [ ] **Step 1: Create `StatusBadge.tsx`**

Create (or overwrite) `apps/console/src/components/Navigator/StatusBadge.tsx`:
```typescript
import type { StageStatus } from "../../types";

const COLOR: Record<StageStatus | "none", string> = {
  not_started: "oklch(30% 0 0)",
  running: "oklch(75% 0.18 260)",
  partial: "oklch(78% 0.18 80)",
  completed: "oklch(70% 0.18 145)",
  validated: "oklch(70% 0.18 145)",
  failed: "oklch(65% 0.22 25)",
  none: "transparent",
};

interface Props { status?: StageStatus | null; unread?: number; }

export function StatusBadge({ status, unread }: Props) {
  if (unread && unread > 0) {
    return (
      <span className="ml-auto text-[10px] px-1.5 rounded-full bg-[oklch(65%_0.18_270)] text-black min-w-[16px] text-center">
        {unread > 99 ? "99+" : unread}
      </span>
    );
  }
  const color = COLOR[(status ?? "none") as keyof typeof COLOR] ?? "transparent";
  if (color === "transparent") return null;
  return <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />;
}
```

If an older `src/components/StatusBadge.tsx` exists and has different semantics, delete it to avoid confusion:
```bash
[ -f apps/console/src/components/StatusBadge.tsx ] && git rm apps/console/src/components/StatusBadge.tsx
```

- [ ] **Step 2: Implement `EpisodeNode.tsx`**

Create `apps/console/src/components/Navigator/EpisodeNode.tsx`:
```typescript
import { useState } from "react";
import type { EpisodeState } from "../../types";
import { StatusBadge } from "./StatusBadge";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";

interface Props {
  epId: string;
  ep: EpisodeState | undefined;
  unread: Map<string, number>;
}

const SUBS: Array<{ label: string; path: (epId: string) => string }> = [
  { label: "Storyboard", path: (id) => `output/${id}/${id}_storyboard.json` },
  { label: "Raw", path: (id) => `output/${id}` },
  { label: "Edited", path: (id) => `output/${id}/edited` },
  { label: "Scored", path: (id) => `output/${id}/scored` },
  { label: "Final", path: (id) => `output/${id}/final` },
];

export function EpisodeNode({ epId, ep, unread }: Props) {
  const [open, setOpen] = useState(false);
  const { openPath } = useTabs();
  const worstStatus =
    ep?.video?.status === "failed" || ep?.storyboard?.status === "failed" ? "failed" :
    ep?.video?.status === "running" ? "running" :
    ep?.video?.status === "completed" ? "completed" :
    ep?.storyboard?.status ?? "not_started";

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-1 text-[12px] text-[oklch(75%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[oklch(42%_0_0)] text-[10px]">{open ? "▾" : "▸"}</span>
        <span>{epId}</span>
        <StatusBadge status={worstStatus as never} unread={unread.get(`output/${epId}`)} />
      </div>
      {open && SUBS.map((sub) => {
        const p = sub.path(epId);
        return (
          <div
            key={sub.label}
            onClick={() => openPath(p, resolveView(p), `${epId}/${sub.label}`, { pinned: false })}
            onDoubleClick={() => openPath(p, resolveView(p), `${epId}/${sub.label}`, { pinned: true })}
            className="pl-10 pr-3 py-1 text-[12px] text-[oklch(55%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer flex items-center gap-2"
          >
            {sub.label}
            <StatusBadge unread={unread.get(p)} />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Implement `StageNode.tsx`**

Create `apps/console/src/components/Navigator/StageNode.tsx`:
```typescript
import { useState, ReactNode } from "react";
import type { StageStatus } from "../../types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  label: string;
  status?: StageStatus;
  unread?: number;
  expandable?: boolean;
  defaultOpen?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  children?: ReactNode;
}

export function StageNode({ label, status, unread, expandable, defaultOpen = false, onClick, onDoubleClick, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-[oklch(75%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
        onClick={() => { if (expandable) setOpen(!open); onClick?.(); }}
        onDoubleClick={onDoubleClick}
      >
        {expandable && <span className="text-[oklch(42%_0_0)] text-[10px]">{open ? "▾" : "▸"}</span>}
        <span>{label}</span>
        <StatusBadge status={status} unread={unread} />
      </div>
      {expandable && open && <div>{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Implement `Navigator.tsx`**

Create `apps/console/src/components/Navigator/Navigator.tsx`:
```typescript
import { useMemo } from "react";
import { useProject } from "../../contexts/ProjectContext";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";
import { StageNode } from "./StageNode";
import { EpisodeNode } from "./EpisodeNode";

export function Navigator() {
  const { name, state, tree } = useProject();
  const { openPath } = useTabs();

  const unread = useMemo(() => new Map<string, number>(), []);
  // weak-follow counters are mutated in Task 15; hold the map reference here.

  if (!name) {
    return <div className="p-3 text-[11px] text-[oklch(42%_0_0)]">请选择项目</div>;
  }

  const has = (path: string) => tree.some((n) => n.path === path);
  const hasPrefix = (prefix: string) => tree.some((n) => n.path.startsWith(prefix + "/"));

  function open(path: string, title: string, pinned: boolean) {
    openPath(path, resolveView(path), title, { pinned });
  }

  const epIds = Object.keys(state?.episodes ?? {}).sort();

  return (
    <div className="py-2 overflow-y-auto h-full text-[13px]">
      <StageNode
        label="Overview"
        status={state?.current_stage ? "running" : undefined}
        onClick={() => open("", "Overview", false)}
        onDoubleClick={() => open("", "Overview", true)}
      />
      {has("output/inspiration.json") && (
        <StageNode
          label="Inspiration"
          status={state?.stages?.INSPIRATION?.status}
          onClick={() => open("output/inspiration.json", "Inspiration", false)}
          onDoubleClick={() => open("output/inspiration.json", "Inspiration", true)}
        />
      )}
      {has("output/script.json") && (
        <StageNode
          label="Script"
          status={state?.stages?.SCRIPT?.status}
          onClick={() => open("output/script.json", "Script", false)}
          onDoubleClick={() => open("output/script.json", "Script", true)}
        />
      )}
      {(hasPrefix("output/actors") || hasPrefix("output/locations") || hasPrefix("output/props")) && (
        <StageNode label="Assets" status={state?.stages?.VISUAL?.status} expandable defaultOpen>
          {hasPrefix("output/actors") && (
            <div
              className="pl-8 pr-3 py-1 text-[12px] text-[oklch(65%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
              onClick={() => open("output/actors", "Actors", false)}
              onDoubleClick={() => open("output/actors", "Actors", true)}
            >Actors</div>
          )}
          {hasPrefix("output/locations") && (
            <div
              className="pl-8 pr-3 py-1 text-[12px] text-[oklch(65%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
              onClick={() => open("output/locations", "Locations", false)}
              onDoubleClick={() => open("output/locations", "Locations", true)}
            >Locations</div>
          )}
          {hasPrefix("output/props") && (
            <div
              className="pl-8 pr-3 py-1 text-[12px] text-[oklch(65%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
              onClick={() => open("output/props", "Props", false)}
              onDoubleClick={() => open("output/props", "Props", true)}
            >Props</div>
          )}
        </StageNode>
      )}
      {epIds.length > 0 && (
        <StageNode label="Episodes" expandable defaultOpen>
          {epIds.map((id) => (
            <EpisodeNode key={id} epId={id} ep={state?.episodes?.[id]} unread={unread} />
          ))}
        </StageNode>
      )}
      {has("draft") && (
        <StageNode
          label="Draft"
          onClick={() => open("draft", "Draft", false)}
          onDoubleClick={() => open("draft", "Draft", true)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Mount in App.tsx**

In `apps/console/src/App.tsx`, replace the left placeholder:
```typescript
        <div className="w-[260px] shrink-0 border-r border-[oklch(20%_0_0)] flex flex-col overflow-hidden">
          <div className="p-3 text-[11px] text-[oklch(42%_0_0)]">Navigator — 待实现</div>
        </div>
```
with:
```typescript
        <div className="w-[260px] shrink-0 border-r border-[oklch(20%_0_0)] flex flex-col overflow-hidden">
          <Navigator />
        </div>
```
Add import:
```typescript
import { Navigator } from "./components/Navigator/Navigator";
```

- [ ] **Step 6: Typecheck + manual smoke**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
bunx tsc --noEmit
bun run dev &
sleep 2
# open http://localhost:5173, pick project c3-1, confirm navigator shows Overview + Script; click Script opens preview tab; double-click pins it
kill %1
```

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/components/Navigator/ apps/console/src/App.tsx
git commit -m "feat(console): Navigator with pipeline tree + preview/pin tabs"
```

---

## Task 15: Weak-follow wiring

**Files:**
- Modify: `apps/console/src/contexts/ProjectContext.tsx` (add `unread` map + `markSeen`)
- Modify: `apps/console/src/hooks/useWebSocket.ts` (emit path signal via callback)
- Modify: `apps/console/src/App.tsx` (bridge WS → ProjectContext refresh + weak-follow)
- Modify: `apps/console/src/components/Navigator/Navigator.tsx` (read `unread`)

- [ ] **Step 1: Extend ProjectContext with unread + markSeen + onToolResult**

Replace the body of `apps/console/src/contexts/ProjectContext.tsx` (additive changes to the existing file):

Update `ProjectContextValue`:
```typescript
interface ProjectContextValue {
  name: string | null;
  state: PipelineState | null;
  tree: TreeNode[];
  isLoading: boolean;
  unread: Map<string, number>;
  setName: (name: string | null) => void;
  refresh: () => void;
  noteToolPath: (path: string) => void;
  markSeen: (path: string) => void;
}
```

Inside `ProjectProvider`, add:
```typescript
  const [unreadTick, setUnreadTick] = useState(0);
  const unreadRef = useRef<Map<string, number>>(new Map());

  const noteToolPath = useCallback((path: string) => {
    const m = unreadRef.current;
    m.set(path, (m.get(path) ?? 0) + 1);
    // bubble up to parent prefixes so stage rows also badge
    const parts = path.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const pre = parts.slice(0, i).join("/");
      m.set(pre, (m.get(pre) ?? 0) + 1);
    }
    setUnreadTick((t) => t + 1);
  }, []);

  const markSeen = useCallback((path: string) => {
    const m = unreadRef.current;
    const count = m.get(path) ?? 0;
    if (count === 0) return;
    m.delete(path);
    // decrement ancestors by the same amount
    const parts = path.split("/");
    for (let i = parts.length - 1; i > 0; i--) {
      const pre = parts.slice(0, i).join("/");
      const c = m.get(pre) ?? 0;
      if (c <= count) m.delete(pre);
      else m.set(pre, c - count);
    }
    setUnreadTick((t) => t + 1);
  }, []);
```

Update `value` to include `unread: unreadRef.current, noteToolPath, markSeen`. Because `unreadTick` is a state change, consumers re-render on every update. Include `unreadTick` in the memo deps so the value reference updates.

```typescript
  const value = useMemo(
    () => ({ name, state, tree, isLoading, unread: unreadRef.current, setName, refresh, noteToolPath, markSeen }),
    [name, state, tree, isLoading, refresh, noteToolPath, markSeen, unreadTick],
  );
```

- [ ] **Step 2: Have useWebSocket accept a callback**

Modify `apps/console/src/hooks/useWebSocket.ts`. Change the hook signature to take an optional `onToolResult` callback:

Find the `export function useWebSocket(url: string)` signature. Change to:
```typescript
export function useWebSocket(url: string, onToolResult?: (path: string) => void, onResult?: () => void) {
```

Wherever the existing `tool_result` event is handled, after the existing merge logic, invoke:
```typescript
        if (event.type === "tool_result") {
          const path = extractPath(event.output);
          if (path && onToolResult) onToolResult(path);
        }
        if (event.type === "result" && onResult) onResult();
```

If `extractPath` does not already exist in the hook file, inline this helper:
```typescript
function extractPath(content: string): string | undefined {
  if (!content) return undefined;
  const m = content.match(/(?:workspace\/[^/\s"]+\/)?((?:output|draft)\/[^\s"]+)/);
  return m?.[1];
}
```

Verify no `canvas`/`routeCanvas` remains:
```bash
grep -n "canvas\|routeCanvas\|CanvasView" apps/console/src/hooks/useWebSocket.ts
```
Expected: no matches.

- [ ] **Step 3: Wire the bridge in App.tsx**

In `apps/console/src/App.tsx`, inside `Shell()`, pull from `ProjectContext` and pass callbacks:

Replace current WS usage:
```typescript
  const { messages, isConnected, isStreaming, send } = useWebSocket(WS_URL);
```
with:
```typescript
  const { noteToolPath, refresh } = useProject();
  const { messages, isConnected, isStreaming, send } = useWebSocket(WS_URL, noteToolPath, refresh);
```

- [ ] **Step 4: Navigator reads `unread` from context**

Modify `apps/console/src/components/Navigator/Navigator.tsx`. Change:
```typescript
  const unread = useMemo(() => new Map<string, number>(), []);
```
to:
```typescript
  const { unread } = useProject();
```

Pass `unread` to `StageNode` where the label has a stable path. For Overview, Inspiration, Script, Assets sub-rows, Draft — pass `unread={unread.get(path)}` as the `unread` prop (for `StageNode`, see Task 14; extend the call sites accordingly). Example:

```typescript
        <StageNode
          label="Script"
          status={state?.stages?.SCRIPT?.status}
          unread={unread.get("output/script.json")}
          onClick={() => { open("output/script.json", "Script", false); markSeen("output/script.json"); }}
          onDoubleClick={() => { open("output/script.json", "Script", true); markSeen("output/script.json"); }}
        />
```

Pull `markSeen` from context: `const { name, state, tree, unread, markSeen } = useProject();`.

Apply the same `markSeen` call inside Assets sub-rows and the Episodes Draft node. For Episodes, mark via the EpisodeNode's click on a sub (you can route `markSeen` through a prop down into `EpisodeNode`).

- [ ] **Step 5: Pass markSeen into EpisodeNode**

In `EpisodeNode.tsx`, add `markSeen?: (p: string) => void` prop and call it on sub-row click:
```typescript
          onClick={() => { openPath(p, resolveView(p), `${epId}/${sub.label}`, { pinned: false }); markSeen?.(p); }}
          onDoubleClick={() => { openPath(p, resolveView(p), `${epId}/${sub.label}`, { pinned: true }); markSeen?.(p); }}
```
In Navigator.tsx, pass it: `<EpisodeNode key={id} epId={id} ep={state?.episodes?.[id]} unread={unread} markSeen={markSeen} />`.

- [ ] **Step 6: Typecheck + smoke**

Run:
```bash
bunx tsc --noEmit
```
Expected: no errors.

Smoke: start dev, simulate WS tool_result in browser console (or pick a project and actually send a message). Confirm a badge appears on the expected node after an agent action.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/contexts/ProjectContext.tsx apps/console/src/hooks/useWebSocket.ts apps/console/src/App.tsx apps/console/src/components/Navigator/
git commit -m "feat(console): weak-follow badges via WS tool_result"
```

---

## Task 16: Final cleanup + full smoke

**Files:**
- Delete (if leftover): `apps/console/src/components/ProjectSelector.tsx`
- Modify: `README.md` (if a console readme exists, update; else skip)

- [ ] **Step 1: Sweep stale files**

Run:
```bash
cd /Users/dingzhijian/lingjing/AgentOS-TS/apps/console
# Stale project selector component (replaced by ProjectSwitcher)
[ -f src/components/ProjectSelector.tsx ] && git rm src/components/ProjectSelector.tsx
# Any remaining CanvasView reference should be a build error, not a string leftover
grep -rn "CanvasView\|CanvasPane" src/ && echo "STALE REFERENCES FOUND" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 2: Full typecheck + test run**

Run:
```bash
bunx tsc --noEmit
bun test
```
Expected: typecheck clean; all tests pass.

- [ ] **Step 3: End-to-end smoke on a real project**

Start dev server:
```bash
bun run dev &
sleep 2
```

Manually verify each item in the checklist below at `http://localhost:5173`:

- [ ] 顶栏显示 AgentOS + 项目下拉 + 连接指示器绿点
- [ ] 选择 `c3-1`，navigator 展开 `Overview` / `Script`；子节点可点开
- [ ] 单击 `Script` → 中栏开 italic 预览 tab，显示 ScriptView 集卡片
- [ ] 双击 `Script` → 预览 tab 转 pinned（去掉 italic）
- [ ] 选择 `c3`（包含更完整数据），展开 Episodes → ep001 → Raw，进入 VideoGridView，点缩略图播放
- [ ] 进入 Actors → AssetGalleryView，点图出 lightbox
- [ ] 在 chat 侧发一条消息（需 `ANTHROPIC_AUTH_TOKEN`），tool_result 到来时，navigator 对应节点出现蓝色未读数字；点击节点后数字归零
- [ ] 关闭窗口 / Ctrl+C：`kill %1`

- [ ] **Step 4: Commit sweep (if any leftover deletions)**

```bash
git add -A
git status
# only commit if there are pending changes from step 1
git diff --cached --quiet || git commit -m "chore(console): sweep stale ProjectSelector + verify clean"
```

---

## Verification Checklist (sign-off)

- [ ] All 16 tasks committed in order with the shown messages
- [ ] `bunx tsc --noEmit` clean
- [ ] `bun test` green (serverUtils, lib, resolveView)
- [ ] Manual smoke from Task 16 Step 3 all passes on `c3-1` and `c3`
- [ ] Spec §§3–8 have corresponding implementations (layout, 3-zone, navigator, viewer, backend endpoints, data flow)
- [ ] No `CanvasView` / `CanvasPane` / `PipelineTimeline` / `StageCard` references remain
- [ ] `output/` directory removed from repo root
