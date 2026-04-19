# SDK Bidirectional Refactor & Full Event Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the "one SDK subprocess per WS message" pattern into "one SDK `query()` per WS connection + project". Plumb `SDKResultSuccess.result` as synthetic `text` events so the final assistant reply can never be swallowed by an empty-bubble filter. Keep all existing client wiring (`session_id` + localStorage + `onSession` callback) working unchanged.

**Architecture:** Introduce a `PushQueue<T>` iterable, a per-WS `AgentSession` object in the orchestrator that wraps `query({prompt: asyncIterable, ...})`, and refactor `server.ts` WS handlers to attach an `AgentSession` slot to each `ServerWebSocket`. First message seeds the query (optionally with `resume: sessionId`); subsequent messages push into the input iterable with zero subprocess churn. Forwarder loop is one-per-session and emits a synthetic `text` stream if the SDK's `result.result` carries content no prior `text` block covered.

**Tech Stack:** Bun 1.x, `@anthropic-ai/claude-agent-sdk@^0.2.x` (streaming input mode), TypeScript strict, React 19 (client untouched).

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-04-21-sdk-bidirectional-refactor-design.md`
- Prior phase spec: `docs/superpowers/specs/2026-04-20-sdk-session-resume-design.md`
- SDK types: `apps/console/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
  - `query()` signature: `sdk.d.ts:2062`
  - `Query` interface (with `close`, `interrupt`, `streamInput`): `sdk.d.ts:1870-2060`
  - `SDKUserMessage`: `sdk.d.ts:3228`
  - `SDKResultSuccess` (with `result: string`): `sdk.d.ts:2899-2919`

**Invariants (DO NOT touch):**
- `PROJECT_ROOT` constant in `orchestrator.ts`.
- `cwd` = `join(PROJECT_ROOT, "workspace", project)` when project provided.
- Skills, MCP servers, `pipeline-state.json` writer logic.
- `WsEvent` union public shape.
- Client `send(message, project?, sessionId?)` signature and payload shape.
- `ProjectContext.setSessionId` / localStorage key / REST endpoints.
- Navigator, Viewer, all Phase B components (ScriptView, StoryboardView, EditableText, SaveStatusDot, fountain lib, useEditableJson).
- `PUT /api/file` endpoint behavior.

**Testing approach:** No unit-test framework in this codebase. Mechanical gate between tasks is `cd apps/console && bunx tsc --noEmit`. Behavioral verification is Task 6 (manual). Commit after every task.

---

## File Structure

| File | Role in this plan |
|---|---|
| `apps/console/src/lib/pushQueue.ts` | **New.** `PushQueue<T>` — minimal AsyncIterable backed by a push buffer. |
| `apps/console/src/orchestrator.ts` | **Rewrite.** `runMock` / `runReal` replaced by `createMockSession` / `createSession` returning an `AgentSession` object. |
| `apps/console/server.ts` | **Modify.** WS handlers attach per-ws `AgentSession` via a `WeakMap`; dispatch messages into the session; close on ws disconnect or project switch. |
| `apps/console/src/hooks/useWebSocket.ts` | **Minimal touch.** Dev-only `console.debug("[ws]", event)` mirror for diagnosis. |
| `apps/console/src/types.ts` | **No change.** `WsEvent` stays as-is. |

---

## Task 1: `PushQueue<T>` minimal AsyncIterable utility

**Files:**
- Create: `apps/console/src/lib/pushQueue.ts`

- [ ] **Step 1: Write the utility**

Create `apps/console/src/lib/pushQueue.ts` with:

```ts
// input: push(value) calls from any caller
// output: async iterable that yields values in push order and terminates on done()
// pos: shared primitive backing SDK streaming input in the orchestrator

export class PushQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.buffer.push(value);
  }

  done(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter({ value: undefined as never, done: true });
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: async (): Promise<IteratorResult<T>> => {
        this.done();
        return { value: undefined as never, done: true };
      },
    };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: exits 0, no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/lib/pushQueue.ts
git commit -m "feat(console): add PushQueue async-iterable primitive for SDK streaming input"
```

---

## Task 2: Orchestrator — `createSession` bidirectional API

**Files:**
- Rewrite: `apps/console/src/orchestrator.ts`

This task replaces the entire orchestrator. Both the mock and real paths now return an `AgentSession` object. The real path wraps a single `query({prompt: AsyncIterable<SDKUserMessage>})` call whose input is fed by `PushQueue`. A synthetic `text` stream is emitted from `SDKResultSuccess.result` if the turn produced no prior `text` block.

- [ ] **Step 1: Rewrite `orchestrator.ts` fully**

Replace the entire contents of `apps/console/src/orchestrator.ts` with:

```ts
// input: project + optional SDK session_id → createSession()
// output: AgentSession with push(message), close(), events async-iterable
// pos: sole adapter between the WS layer and the Claude Agent SDK's streaming query

import type { WsEvent } from "./types";
import { query, type SDKUserMessage, type Query } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import { PushQueue } from "./lib/pushQueue";

const PROJECT_ROOT = join(import.meta.dirname, "../../..");

export interface AgentSession {
  push(message: string): void;
  close(): Promise<void>;
  events: AsyncIterable<WsEvent>;
  readonly projectKey: string | null;
}

function buildSDKUserMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

function extractWorkspacePath(content: string): string | undefined {
  const m = content.match(/(?:workspace|output)\/[^\s"']+/);
  return m?.[0];
}

// ---------------------------------------------------------------------------
// Real session — wraps SDK query() in streaming input mode
// ---------------------------------------------------------------------------

export function createSession(project?: string, resumeId?: string): AgentSession {
  const projectKey = project ?? null;
  const cwd = project ? join(PROJECT_ROOT, "workspace", project) : PROJECT_ROOT;

  const inputQueue = new PushQueue<SDKUserMessage>();
  const events = new PushQueue<WsEvent>();

  const sdkQuery: Query = query({
    prompt: inputQueue,
    options: {
      cwd,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(resumeId ? { resume: resumeId } : {}),
    },
  });

  let textEmittedThisTurn = false;
  let closed = false;

  const pump = (async () => {
    try {
      for await (const msg of sdkQuery) {
        const type = msg.type;

        if (type === "system") {
          const sys = msg as { subtype?: string; session_id?: string };
          if (sys.subtype === "init" && typeof sys.session_id === "string") {
            events.push({ type: "session", sessionId: sys.session_id });
          }
          events.push({ type: "system", subtype: sys.subtype ?? "unknown", data: msg });
          continue;
        }

        if (type === "assistant") {
          const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
          for (const block of content as Array<{
            type: string;
            text?: string;
            id?: string;
            name?: string;
            input?: unknown;
          }>) {
            if (block.type === "text" && block.text) {
              textEmittedThisTurn = true;
              for (const ch of block.text) {
                events.push({ type: "text", text: ch });
              }
            }
            if (block.type === "tool_use") {
              events.push({
                type: "tool_use",
                id: block.id ?? "",
                tool: block.name ?? "",
                input: block.input,
              });
            }
          }
          continue;
        }

        if (type === "user") {
          const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
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
              events.push({
                type: "tool_result",
                id: block.tool_use_id ?? "",
                tool: "",
                output,
                path: extractWorkspacePath(output),
              });
            }
          }
          continue;
        }

        if (type === "result") {
          const r = msg as {
            subtype?: string;
            duration_ms?: number;
            is_error?: boolean;
            result?: string;
          };
          const isSuccess = r.subtype === "success" && r.is_error !== true;
          if (
            isSuccess &&
            typeof r.result === "string" &&
            r.result.length > 0 &&
            !textEmittedThisTurn
          ) {
            for (const ch of r.result) {
              events.push({ type: "text", text: ch });
            }
          }
          events.push({
            type: "result",
            exitCode: isSuccess ? 0 : 1,
            duration: r.duration_ms ?? 0,
          });
          textEmittedThisTurn = false;
          continue;
        }

        events.push({ type: "system", subtype: String(type), data: msg });
      }
    } catch (err) {
      if (!closed) {
        events.push({ type: "error", message: String(err) });
      }
    } finally {
      events.done();
    }
  })();

  return {
    projectKey,
    events,
    push(message: string) {
      if (closed) return;
      inputQueue.push(buildSDKUserMessage(message));
    },
    async close() {
      if (closed) return;
      closed = true;
      inputQueue.done();
      try {
        sdkQuery.close();
      } catch {
        // ignore
      }
      try {
        await pump;
      } catch {
        // already handled
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mock session — kept for offline / dev smoke; same shape as createSession
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createMockSession(project?: string): AgentSession {
  const events = new PushQueue<WsEvent>();
  let closed = false;
  let turn = 0;

  async function runTurn(message: string) {
    turn++;
    events.push({ type: "text", text: "正在分析请求" });
    await sleep(200);
    events.push({ type: "text", text: `：「${message}」\n\n` });
    await sleep(200);
    events.push({
      type: "tool_use",
      id: `mock_${turn}`,
      tool: "Read",
      input: { file_path: `workspace/${project ?? "demo"}/pipeline-state.json` },
    });
    await sleep(300);
    events.push({
      type: "tool_result",
      id: `mock_${turn}`,
      tool: "Read",
      output: '{"current_stage":"VIDEO","stages":{}}',
      path: `workspace/${project ?? "demo"}/pipeline-state.json`,
    });
    await sleep(200);
    events.push({ type: "text", text: `mock 回复 · turn ${turn}` });
    events.push({ type: "result", exitCode: 0, duration: 900 });
  }

  return {
    projectKey: project ?? null,
    events,
    push(message: string) {
      if (closed) return;
      void runTurn(message);
    },
    async close() {
      if (closed) return;
      closed = true;
      events.done();
    },
  };
}

// ---------------------------------------------------------------------------
// Active export — swap createMockSession → createSession here
// ---------------------------------------------------------------------------

export const createAgentSession = createSession;
```

- [ ] **Step 2: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: a new error from `server.ts` saying `runAgent` does not exist. This is expected — Task 3 refactors the server to use `createAgentSession`. Do not revert.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/orchestrator.ts
git commit -m "feat(console): refactor orchestrator to per-session bidirectional SDK query"
```

---

## Task 3: Server — `AgentSession` per WS with project-switch handling

**Files:**
- Modify: `apps/console/server.ts:181-207` (websocket handlers block)

- [ ] **Step 1: Update imports**

At the top of `apps/console/server.ts`, replace the existing `import { runAgent } from "./src/orchestrator";` with:

```ts
import { createAgentSession, type AgentSession } from "./src/orchestrator";
import type { ServerWebSocket } from "bun";
```

- [ ] **Step 2: Replace the websocket handlers**

Replace the entire `websocket: { open(...), async message(...), close(...) }` block (currently at `apps/console/server.ts:181-207`) with:

```ts
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
```

- [ ] **Step 3: Add the sessions map near the top of the file**

Immediately after the `const WORKSPACE = join(...)` line near the top of `apps/console/server.ts`, add:

```ts
interface WsSlot {
  project: string | null;
  session: AgentSession | null;
}

const sessions = new WeakMap<ServerWebSocket<unknown>, WsSlot>();
```

- [ ] **Step 4: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: exits 0. Task 2's introduced error is now resolved.

- [ ] **Step 5: Commit**

```bash
git add apps/console/server.ts
git commit -m "feat(console): per-WS AgentSession with project-switch + close-on-disconnect"
```

---

## Task 4: Client — dev-mode WS event logging (diagnostic aid)

Optional but cheap. Helps the user reproduce and debug any lingering event-consumption gaps without shipping noise to production.

**Files:**
- Modify: `apps/console/src/hooks/useWebSocket.ts:41-54`

- [ ] **Step 1: Add a single dev-only log at the top of `ws.onmessage`**

In `apps/console/src/hooks/useWebSocket.ts`, locate the existing `ws.onmessage = (e) => { const event: WsEvent = JSON.parse(e.data); ...` block. Immediately after `const event: WsEvent = JSON.parse(e.data);` (currently line 42), insert:

```ts
if (import.meta.env.DEV) {
  console.debug("[ws]", event.type, event);
}
```

Leave the existing `if (event.type === "system") { ... }` debug log in place — it's a narrower dump and complements the top-level log.

- [ ] **Step 2: Type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/hooks/useWebSocket.ts
git commit -m "feat(console): dev-mode WS event console.debug for diagnosis"
```

---

## Task 5: Type-check + build gate

- [ ] **Step 1: Final type-check**

Run: `cd apps/console && bunx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 2: Production build**

Run: `cd apps/console && bun run build`
Expected: exits 0, no new warnings about unknown SDK types.

- [ ] **Step 3: Commit (only if fixes were needed)**

If either command required a fix, commit with a focused message. Otherwise skip.

---

## Task 6: Manual end-to-end verification

Maps 1:1 to the spec's Test Plan. Every step is user-runnable; capture failures as issues before declaring the plan done.

- [ ] **Step 1: Start dev server**

Run: `cd apps/console && bun run dev`
Expected: `API → http://localhost:3001  WS → ws://localhost:3001/ws` and Vite URL. Browser auto-opens.

- [ ] **Step 2: Multi-turn warmth**

Select an existing project in the switcher. Send "你好". Wait for the full reply (a `text` stream followed by a `result`). Immediately send "刚才我说了什么".
Expected: turn 2 starts faster than turn 1 (no SDK subprocess respawn), and the assistant references "你好" correctly.

- [ ] **Step 3: Final-text is never empty**

Send "请 Read workspace/<projectName>/pipeline-state.json 并用一句话总结" (substitute a real project name).
Expected: one tool card appears, then at least one assistant text bubble appears after it. No "only tool card" pathology.

- [ ] **Step 4: sessionId persists**

Browser DevTools → Application → Local Storage. Verify `agentos:session:<project>` holds a UUID. Hard-refresh (Cmd+Shift+R), re-select the same project, send "我第一句话说了什么".
Expected: the assistant recalls "你好" — resume via localStorage still works.

- [ ] **Step 5: Cross-project isolation**

Switch to a different project in the switcher. Send "我第一句话说了什么".
Expected: fresh session — assistant does not recall "你好". A DIFFERENT localStorage slot accumulates its own sessionId.

- [ ] **Step 6: Explicit session clear**

DevTools console: `localStorage.removeItem("agentos:session:<projectName>")`. Send a new message.
Expected: fresh SDK session; a new UUID is persisted.

- [ ] **Step 7: Empty-result preservation**

Ask the agent for something that legitimately produces only tool output ("只读文件, 不要评论"). Observe the final turn.
Expected: no synthetic text injected if `result.result` is empty; the UI shows tool-only without a fake reply bubble.

- [ ] **Step 8: Clean close on disconnect**

While a turn is streaming, close the browser tab. Check server stderr.
Expected: a "WS disconnected" log and no orphaned subprocess stderr noise. Reopen the tab; new WS connects cleanly.

- [ ] **Step 9: Cost sanity (informational)**

After several turns, inspect DevTools Network → WS frames. Count the number of `system` subtype `init` frames across the session.
Expected: exactly ONE `init` per fresh SDK subprocess (i.e., one per first-message-per-session). Subsequent turns in the same session should NOT produce new `init` frames.

- [ ] **Step 10: Commit if fixes required**

If any prior step needed a code fix, commit with a message describing the fix. Otherwise no commit.

---

## Done criteria

- Every task's checkboxes checked.
- `git log --oneline` shows at least 4 new commits (Tasks 1-4) since `f93720d docs(console): archive chat-ui + sdk-session-resume specs and plans`.
- `bunx tsc --noEmit` and `bun run build` green.
- Manual verification Steps 2-9 all pass.
- Invariants listed at the top of this plan untouched.
