# SDK Session Resume & Event Passthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plumb the Claude Agent SDK's native `session_id` + `resume` through the WS layer so the same project can carry multi-turn conversation across messages and browser refreshes, while bypassing tool permissions by default.

**Architecture:** Single-direction WS. Server extracts `session_id` from SDK's `system.init` event and forwards to client. Client persists to `localStorage` keyed by project name via `ProjectContext`, then attaches it to subsequent sends. Orchestrator passes `resume` + `permissionMode: 'bypassPermissions'` to `query()`. Event envelope widens to lossless SDK passthrough (`system` subtype).

**Tech Stack:** Bun 1.x, `@anthropic-ai/claude-agent-sdk@^0.2.114`, React 19, TypeScript strict, Vite.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-04-20-sdk-session-resume-design.md`
- SDK query options: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (search for `permissionMode`, `resume`, `SDKSystemMessage`)

**Invariants (DO NOT touch):**
- `PROJECT_ROOT` constant in `orchestrator.ts`.
- `cwd` passed to `query()` must remain `join(PROJECT_ROOT, "workspace", project)` when project is provided. Generated artifacts must land in `workspace/${project}/`.
- Skills, MCP servers, pipeline-state.json semantics.
- Navigator / Viewer / StageNode / EpisodeNode components.
- Existing WS URL path (`/ws`), REST endpoints, file-serving routes.

**Testing approach:** This codebase has no unit test framework (no vitest/jest, no `*.test.*` files). Use TypeScript type-check (`bunx tsc --noEmit`) as the mechanical gate between tasks, and defer full behavioral verification to the manual pass in Task 8. Commit after every task so each step is revertable.

---

## File Structure

| File | Role in this plan |
|---|---|
| `apps/console/src/types.ts` | Owns `WsEvent` union. Extended with `session` and `system` variants. |
| `apps/console/src/orchestrator.ts` | Owns SDK `query()` invocation. Takes new `sessionId` parameter, injects `permissionMode: 'bypassPermissions'` and conditional `resume`. Intercepts `system.init` to yield `session` event. Unknown `SDKMessage` types forwarded as `system`. |
| `apps/console/server.ts` | Accepts `sessionId` in WS inbound payload; forwards `project` (previously dropped) and `sessionId` to `runAgent`. |
| `apps/console/src/contexts/ProjectContext.tsx` | Adds `sessionId: string \| null`, `setSessionId(id)`. Reads/writes `localStorage["agentos:session:"+name]`. Hydrates on project switch; clears slot on explicit request. |
| `apps/console/src/hooks/useWebSocket.ts` | Widens `send(message, project?, sessionId?)`. Widens event handling to cover `session` and `system` types. Adds `onSession` callback ref. |
| `apps/console/src/App.tsx` | Wires `sessionId` from `ProjectContext` into `send`, and `onSession` callback into `ProjectContext.setSessionId`. |

---

## Task 1: Extend `WsEvent` union with `session` and `system` variants

**Files:**
- Modify: `apps/console/src/types.ts:38-43`

- [ ] **Step 1: Update the `WsEvent` type**

Replace the current definition at `apps/console/src/types.ts:38-43` with:

```ts
// WebSocket 事件（服务端 → 前端）
export type WsEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; tool: string; output: string; path?: string }
  | { type: "result"; exitCode: number; duration: number }
  | { type: "system"; subtype: string; data: unknown }
  | { type: "error"; message: string };
```

- [ ] **Step 2: Run TypeScript type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exits 0 with no new errors. Pre-existing errors (if any) unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/types.ts
git commit -m "feat(console): widen WsEvent with session and system variants"
```

---

## Task 2: Fix server to forward `project` and accept `sessionId`

> Preexisting bug: `server.ts:129` currently calls `runAgent(payload.message)` without `project`, so `cwd` silently falls back to the repo root. This violates the workspace invariant. Fixed here as prerequisite.

**Files:**
- Modify: `apps/console/server.ts:119-135`

- [ ] **Step 1: Update the WebSocket message handler**

Replace `apps/console/server.ts:119-135` with:

```ts
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
```

- [ ] **Step 2: Run TypeScript type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: A new error from `orchestrator.ts` saying `runAgent` doesn't accept 3 arguments. This is expected — Task 3 adds the parameter. Do NOT fix by reverting; proceed.

- [ ] **Step 3: Commit**

```bash
git add apps/console/server.ts
git commit -m "fix(console): forward project and sessionId from WS payload to runAgent"
```

---

## Task 3: Orchestrator — bypassPermissions, resume, system.init passthrough

**Files:**
- Modify: `apps/console/src/orchestrator.ts:49-133`

- [ ] **Step 1: Update `runReal` signature and `query()` options**

Replace `apps/console/src/orchestrator.ts:49-133` with:

```ts
export async function* runReal(
  message: string,
  project?: string,
  sessionId?: string,
): AsyncGenerator<WsEvent> {
  const cwd = project
    ? join(PROJECT_ROOT, "workspace", project)
    : PROJECT_ROOT;

  try {
    for await (const msg of query({
      prompt: message,
      options: {
        cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        ...(sessionId ? { resume: sessionId } : {}),
      },
    })) {
      const type = msg.type;

      if (type === "system") {
        const sys = msg as { subtype?: string; session_id?: string };
        if (sys.subtype === "init" && typeof sys.session_id === "string") {
          yield { type: "session", sessionId: sys.session_id };
        }
        yield { type: "system", subtype: sys.subtype ?? "unknown", data: msg };
        continue;
      }

      if (type === "assistant") {
        const content = (msg as { message?: { content?: unknown[] } }).message
          ?.content ?? [];

        for (const block of content as Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }>) {
          if (block.type === "text" && block.text) {
            for (const char of block.text) {
              yield { type: "text", text: char };
            }
          }
          if (block.type === "tool_use") {
            yield {
              type: "tool_use",
              id: block.id ?? "",
              tool: block.name ?? "",
              input: block.input,
            };
          }
        }
        continue;
      }

      if (type === "user") {
        const content = (msg as { message?: { content?: unknown[] } }).message
          ?.content ?? [];

        for (const block of content as Array<{
          type: string;
          tool_use_id?: string;
          content?: unknown;
        }>) {
          if (block.type === "tool_result") {
            const output =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
            yield {
              type: "tool_result",
              id: block.tool_use_id ?? "",
              tool: "",
              output,
              path: extractWorkspacePath(output),
            };
          }
        }
        continue;
      }

      if (type === "result") {
        const r = msg as {
          subtype?: string;
          duration_ms?: number;
          is_error?: boolean;
        };
        const isError = r.is_error === true || r.subtype !== "success";
        yield {
          type: "result",
          exitCode: isError ? 1 : 0,
          duration: r.duration_ms ?? 0,
        };
        continue;
      }

      yield { type: "system", subtype: String(type), data: msg };
    }
  } catch (err) {
    yield { type: "error", message: String(err) };
  }
}
```

- [ ] **Step 2: Run TypeScript type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exits 0. The error introduced in Task 2 is now resolved.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/orchestrator.ts
git commit -m "feat(console): bypass tool permissions and resume SDK session via session_id"
```

---

## Task 4: `ProjectContext` owns `sessionId` with localStorage persistence

**Files:**
- Modify: `apps/console/src/contexts/ProjectContext.tsx:4-14` (interface)
- Modify: `apps/console/src/contexts/ProjectContext.tsx:29-130` (provider body + export)

- [ ] **Step 1: Extend the context interface**

Replace `apps/console/src/contexts/ProjectContext.tsx:4-14` with:

```tsx
interface ProjectContextValue {
  name: string | null;
  state: PipelineState | null;
  tree: TreeNode[];
  isLoading: boolean;
  unread: Map<string, number>;
  sessionId: string | null;
  setName: (name: string | null) => void;
  refresh: () => void;
  noteToolPath: (path: string) => void;
  markSeen: (path: string) => void;
  setSessionId: (id: string | null) => void;
}
```

- [ ] **Step 2: Add session storage helpers above `ProjectProvider`**

Insert immediately before `export function ProjectProvider` (currently at `apps/console/src/contexts/ProjectContext.tsx:29`) the following helpers:

```tsx
const SESSION_KEY_PREFIX = "agentos:session:";

function readStoredSession(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_KEY_PREFIX + name);
  } catch {
    return null;
  }
}

function writeStoredSession(name: string, id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(SESSION_KEY_PREFIX + name, id);
    else window.localStorage.removeItem(SESSION_KEY_PREFIX + name);
  } catch {
    // private mode or quota — fall through; in-memory state still works
  }
}
```

- [ ] **Step 3: Wire `sessionId` state inside `ProjectProvider`**

Inside `ProjectProvider`, immediately after the existing `const [name, setName] = useState<string | null>(null);` line, add:

```tsx
const [sessionId, setSessionIdState] = useState<string | null>(null);
```

In the `useEffect(() => { if (!name) { ... } ... }, [name])` block (currently `apps/console/src/contexts/ProjectContext.tsx:37-65`), replace the body with:

```tsx
useEffect(() => {
  if (!name) {
    setState(null);
    setTree([]);
    setSessionIdState(null);
    unreadRef.current.clear();
    setUnreadTick((t) => t + 1);
    return;
  }
  abortRef.current?.abort();
  unreadRef.current.clear();
  setUnreadTick((t) => t + 1);
  setSessionIdState(readStoredSession(name));
  const ac = new AbortController();
  abortRef.current = ac;
  setIsLoading(true);
  loadFor(name, ac.signal)
    .then(({ state: s, tree: t }) => {
      if (ac.signal.aborted) return;
      setState(s);
      setTree(t);
    })
    .catch((err) => {
      if (err?.name === "AbortError") return;
      console.error("[ProjectContext] load failed", err);
    })
    .finally(() => {
      if (!ac.signal.aborted) setIsLoading(false);
    });
  return () => ac.abort();
}, [name]);
```

Define `setSessionId` (exposed to consumers) near the other `useCallback`s, before the `const value = useMemo(...)` line. Add:

```tsx
const setSessionId = useCallback(
  (id: string | null) => {
    setSessionIdState(id);
    if (name) writeStoredSession(name, id);
  },
  [name],
);
```

Replace the `const value = useMemo(...)` block (currently `apps/console/src/contexts/ProjectContext.tsx:125-128`) with:

```tsx
const value = useMemo(
  () => ({
    name,
    state,
    tree,
    isLoading,
    unread: unreadRef.current,
    sessionId,
    setName,
    refresh,
    noteToolPath,
    markSeen,
    setSessionId,
  }),
  [name, state, tree, isLoading, sessionId, refresh, noteToolPath, markSeen, setSessionId, unreadTick],
);
```

- [ ] **Step 4: Run TypeScript type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/contexts/ProjectContext.tsx
git commit -m "feat(console): persist SDK sessionId per project in ProjectContext"
```

---

## Task 5: `useWebSocket` sends `sessionId` and surfaces `session` events

**Files:**
- Modify: `apps/console/src/hooks/useWebSocket.ts:15-129`

- [ ] **Step 1: Extend hook signature and add `session`/`system` handling**

Replace the entire body of `apps/console/src/hooks/useWebSocket.ts` (keep the file header comment and `uid`/`extractPath` helpers) starting from `export function useWebSocket(` to the end:

```ts
export function useWebSocket(
  url: string,
  onToolResult?: (path: string) => void,
  onResult?: () => void,
  onSession?: (sessionId: string | null) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const streamingIdRef = useRef<string | null>(null);

  const onToolResultRef = useRef(onToolResult);
  const onResultRef = useRef(onResult);
  const onSessionRef = useRef(onSession);
  useEffect(() => { onToolResultRef.current = onToolResult; }, [onToolResult]);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onSessionRef.current = onSession; }, [onSession]);

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (e) => {
      const event: WsEvent = JSON.parse(e.data);

      if (event.type === "session") {
        onSessionRef.current?.(event.sessionId);
        return;
      }

      if (event.type === "system") {
        // Lossless passthrough; no UI surface yet. Keep for debugging.
        console.debug("[ws] system", event.subtype, event.data);
        return;
      }

      if (event.type === "text") {
        setIsStreaming(true);
        setMessages((prev) => {
          const existingId = streamingIdRef.current;
          if (existingId) {
            return prev.map((m) =>
              m.id === existingId ? { ...m, content: m.content + event.text } : m
            );
          }
          const newId = uid();
          streamingIdRef.current = newId;
          return [
            ...prev,
            { id: newId, role: "assistant", content: event.text, isStreaming: true, timestamp: Date.now() },
          ];
        });
      }

      if (event.type === "tool_use") {
        if (streamingIdRef.current) {
          setMessages((prev) =>
            prev.map((m) => m.id === streamingIdRef.current ? { ...m, isStreaming: false } : m)
          );
          streamingIdRef.current = null;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: `tool_${event.id}`,
            role: "assistant",
            content: "",
            toolName: event.tool,
            toolInput: event.input,
            isStreaming: true,
            timestamp: Date.now(),
          },
        ]);
      }

      if (event.type === "tool_result") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `tool_${event.id}` ? { ...m, toolOutput: event.output, isStreaming: false } : m
          )
        );
        const p = extractPath(event.output);
        if (p) onToolResultRef.current?.(p);
        onResultRef.current?.();
      }

      if (event.type === "result") {
        setIsStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) =>
          prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        );
        onResultRef.current?.();
      }

      if (event.type === "error") {
        setIsStreaming(false);
        streamingIdRef.current = null;
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: `错误：${event.message}`, timestamp: Date.now() },
        ]);
      }
    };

    return () => ws.close();
  }, [url]);

  const send = useCallback(
    (message: string, project?: string, sessionId?: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: message,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      wsRef.current.send(JSON.stringify({ message, project, sessionId }));
    },
    []
  );

  return { messages, isConnected, isStreaming, send };
}
```

- [ ] **Step 2: Run TypeScript type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/hooks/useWebSocket.ts
git commit -m "feat(console): wire sessionId through useWebSocket send+receive"
```

---

## Task 6: `App.tsx` ties `sessionId` between context and WS

**Files:**
- Modify: `apps/console/src/App.tsx:12-18`

- [ ] **Step 1: Wire `sessionId` + `setSessionId` into the shell**

Replace `apps/console/src/App.tsx:12-18` with:

```tsx
function Shell() {
  const { name, setName, noteToolPath, refresh, sessionId, setSessionId } = useProject();
  const { messages, isConnected, isStreaming, send } = useWebSocket(
    WS_URL,
    noteToolPath,
    refresh,
    setSessionId,
  );

  function handleSend(message: string) {
    send(message, name ?? undefined, sessionId ?? undefined);
  }
```

- [ ] **Step 2: Run TypeScript type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/App.tsx
git commit -m "feat(console): bind ProjectContext sessionId to WS send/receive in Shell"
```

---

## Task 7: Clear stored sessionId on WS error

Recovering from an expired / invalid session: when the server yields an `error` event (typically because `resume` points to a session the SDK can't continue), the client must drop the stale sessionId so the next send starts fresh.

**Files:**
- Modify: `apps/console/src/hooks/useWebSocket.ts` (the `if (event.type === "error")` branch added in Task 5)

- [ ] **Step 1: Invoke `onSession(null)` inside the error branch**

In `apps/console/src/hooks/useWebSocket.ts`, locate the error branch added in Task 5:

```ts
if (event.type === "error") {
  setIsStreaming(false);
  streamingIdRef.current = null;
  setMessages((prev) => [
    ...prev,
    { id: uid(), role: "assistant", content: `错误：${event.message}`, timestamp: Date.now() },
  ]);
}
```

Replace it with:

```ts
if (event.type === "error") {
  setIsStreaming(false);
  streamingIdRef.current = null;
  onSessionRef.current?.(null);
  setMessages((prev) => [
    ...prev,
    { id: uid(), role: "assistant", content: `错误：${event.message}`, timestamp: Date.now() },
  ]);
}
```

The `onSession` parameter type was defined as `(sessionId: string | null) => void` in Task 5, so `null` typechecks directly. `ProjectContext.setSessionId` (from Task 4) also accepts `string | null` — the call chain is clean.

- [ ] **Step 2: Run TypeScript type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: Exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/hooks/useWebSocket.ts
git commit -m "feat(console): clear persisted sessionId when WS yields error"
```

---

## Task 8: Manual end-to-end verification

No automated tests exist; this task walks through the spec's Test Plan. Capture any failure as a bug and fix before declaring the plan complete.

**Preconditions:**
- At least one real project exists under `workspace/` with a valid `pipeline-state.json`.
- `ANTHROPIC_API_KEY` (or the SDK's configured auth) is set and working.

- [ ] **Step 1: Start dev server**

Run from repo root: `cd apps/console && bun run dev`
Expected: Console shows `API → http://localhost:3001  WS → ws://localhost:3001/ws` and Vite URL. Browser auto-opens to the app.

- [ ] **Step 2: Multi-turn memory within one session**

In the browser: select an existing project in the header switcher. In the chat pane, send "我叫小明". Wait for the assistant to finish. Then send "我叫什么".
Expected: Assistant answers "小明" or equivalent. If it doesn't know, session resume is broken.

- [ ] **Step 3: Confirm sessionId landed in localStorage**

Browser DevTools → Application → Local Storage → `http://localhost:5173` (or whichever Vite port).
Expected: A key `agentos:session:<projectName>` with a non-empty UUID-ish value.

- [ ] **Step 4: Confirm sessionId is sent on the second turn**

Browser DevTools → Network → WS connection → Messages tab. Send a third message.
Expected: The outbound frame JSON contains the `sessionId` field matching localStorage.

- [ ] **Step 5: Cross-refresh survival**

Hard-refresh the browser (Cmd+Shift+R). Re-select the same project. Send "我叫什么".
Expected: Assistant still answers "小明". The ProjectContext rehydrated sessionId from localStorage.

- [ ] **Step 6: Fresh session after manual clear**

DevTools console: `localStorage.removeItem("agentos:session:<projectName>")`. Then send "我叫什么" again.
Expected: Assistant no longer knows. A new `agentos:session:<projectName>` entry appears with a different UUID after the response.

- [ ] **Step 7: No permission prompts for tools**

Ask the assistant to do something requiring a file tool, e.g., "Read workspace/\<projectName\>/pipeline-state.json and summarize."
Expected: The tool executes without any permission-prompt UI or console warnings about blocked tools.

- [ ] **Step 8: Artifacts stay inside project workspace**

Ask the assistant to "write a file test-sdk-resume.txt with content 'hello' in the project workspace". After completion, from the repo root:

Run: `ls workspace/<projectName>/test-sdk-resume.txt`
Expected: File exists. Also run `ls test-sdk-resume.txt` from repo root — expected: `No such file or directory`. Finally, clean up: `rm workspace/<projectName>/test-sdk-resume.txt`.

- [ ] **Step 9: Project isolation**

Select a different project via the switcher. Send "我叫什么".
Expected: Assistant does NOT know "小明" — the other project has its own sessionId slot (or none). Switch back to the first project and resend — expected: still remembers "小明".

- [ ] **Step 10: Final type-check + build**

Run: `cd apps/console && bunx tsc --noEmit && bun run build`
Expected: Both exit 0.

- [ ] **Step 11: Commit (only if Task 8 required fixes)**

If any of Steps 2-10 required code changes, commit them with a message describing the specific fix. Otherwise no commit for this task.

---

## Done criteria

- Every task's checkboxes are checked.
- `git log --oneline` shows at least 6 new commits (Tasks 1-6) and possibly 7 (Task 7); Task 8 may or may not add commits.
- `bunx tsc --noEmit` and `bun run build` both green.
- Manual verification steps 2-9 all pass.
- The invariants listed at the top of this plan are untouched.
