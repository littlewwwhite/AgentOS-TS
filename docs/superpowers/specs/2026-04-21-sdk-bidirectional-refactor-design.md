# SDK Bidirectional Refactor & Full Event Consumption Design

**Status:** Draft · 2026-04-21
**Scope:** `apps/console/` server + orchestrator (and minimal WS client touch-ups)
**Phase:** C-2 of the console rebuild (follows C-1: session_id + bypassPermissions landed via 2026-04-20-sdk-session-resume-design.md)

## Goal

Replace the one-shot `query({prompt: string})` per WS message with a **per-WS-connection bidirectional streaming query** using `query({prompt: AsyncIterable<SDKUserMessage>})`. Plumb `SDKResultSuccess.result` into the event stream so the final assistant text is never lost. Keep `session_id` + localStorage resume as the cross-connection fallback.

## Problem Statement

Two concrete defects in the current implementation (commits C1-C7, 6329a26..):

### Defect 1 — cold-start per turn

`apps/console/server.ts:186-202` calls `runAgent(message, project, sessionId)` on every inbound WS frame. `runAgent → runReal` starts a fresh `query({prompt: string, options: {resume}})` each time. The SDK subprocess spawns, reloads the transcript, re-initializes MCP servers, and only then resumes the turn. On a populated session this is 3-5s of user-visible latency per message, and it accumulates.

### Defect 2 — final text can vanish

`SDKResultSuccess.result: string` carries the final assistant text (per `sdk.d.ts:2907`). The orchestrator drops this field:

```ts
// orchestrator.ts:137-149 (current)
if (type === "result") {
  const r = msg as { subtype?: string; duration_ms?: number; is_error?: boolean };
  const isError = r.is_error === true || r.subtype !== "success";
  yield { type: "result", exitCode: isError ? 1 : 0, duration: r.duration_ms ?? 0 };
  continue;
}
```

When the model produces `[tool_use, tool_result, result]` without a trailing `assistant.text` block (common for short replies after a tool call), the UI sees only tool cards — the client's empty-bubble filter (`useWebSocket.ts:113`) culls the zero-length streaming bubble, leaving no final text. This is the "只有工具调用但是没有真正的回复内容" bug reported in user feedback.

## Non-Goals

- No `canUseTool` callback — permissions stay bypassed.
- No `unstable_v2_createSession` / `SDKSession`.
- No UI for interrupt/setModel — the SDK's new control APIs stay unused for now (design leaves the door open).
- No changes to Navigator / Viewer / editable-JSON pipeline / fountain lib / Phase B primitives.
- No changes to skills, MCP servers, or `pipeline-state.json` schema.
- No multi-WS-connection session sharing (one WS ↔ one Query).

## Invariants (must not regress)

1. `cwd` passed to `query()` stays `join(PROJECT_ROOT, "workspace", project)` or `PROJECT_ROOT` if project is absent.
2. `WsEvent` union's client-visible shape is unchanged (`session / text / tool_use / tool_result / result / system / error`).
3. `send(message, project?, sessionId?)` client signature and outbound payload shape (`{message, project, sessionId}`) stay the same. No client refactor beyond a no-op.
4. `localStorage["agentos:session:<project>"]` key, value format, and the `ProjectContext.setSessionId` contract are untouched.
5. REST endpoints (`/api/projects`, `/api/projects/:name`, `/api/projects/:name/tree`, `/files/:project/*`, `PUT /api/file`) are untouched.
6. Navigator weak-follow (`tool_result` path → unread badge) keeps working.
7. No new on-disk state — memory only.

## Architecture

### Before (one-shot)

```
ws.message → runAgent(msg, project, sessionId) → query({prompt: msg, resume})
                                                    ↓ drains SDKMessage stream
                                                  yields WsEvent[]
                                                  terminates
```

Every `ws.message` pays the SDK spawn cost. `sessionId` is the only continuity.

### After (bidirectional, per-WS)

```
ws.open   → registers empty session slot on ws
ws.message → push SDKUserMessage into session.inputQueue
                 ↓ (on first message only) lazy-start session.query
                 ↓ query.prompt = asyncIterable(session.inputQueue)
                 ↓ consumer: for await (msg of session.query) → ws.send(wsEvent)
             session stays alive until ws.close OR project switch
ws.close  → session.input.done() + query.close()
```

One SDK subprocess per WS. Subsequent messages pipe into the same transcript without re-init. `session_id` from the first `system.init` is still persisted so a fresh WS connection can `resume` into the same conversation.

### Session object (in-memory, per-WS)

```ts
interface WsSession {
  project: string | null;         // cwd scope; null → repo root
  inputQueue: PushQueue<SDKUserMessage>;  // backs query.prompt
  query: Query | null;            // lazy; created on first message
  consumerTask: Promise<void> | null;  // drains query → ws
  active: boolean;
}
```

- `PushQueue<T>` — a minimal async-iterable-plus-push class (implement in a dedicated file, ~40 lines).
- `query` is `null` until the first user message arrives (we need the first message to seed `prompt: AsyncIterable<SDKUserMessage>` — can't create it empty without burning subprocess time).
- `consumerTask` runs `for await (const m of session.query!)` and forwards via the WS. It ends when the query terminates (error/result) OR when we call `query.close()`.

### Project switch handling

If a new WS message arrives with a different `project` than the current session:

1. `await session.query?.close()`; await the consumer to unwind.
2. Reset `session` to a fresh slot with the new project.
3. Proceed with the new message (seeds fresh query).

This is exactly what "one Query per project within a WS" means. Simpler than tracking multiple queries per WS.

### First-message flow (new session)

```
payload = {message, project?, sessionId?}
  ↓
ensureSession(ws, project):
  if no session or project mismatch → close + new session
  return session
  ↓
pushUserMessage(session, message, sessionId):
  if session.query === null:
    session.query = query({
      prompt: asyncIterable(session.inputQueue),
      options: { cwd, permissionMode, allowDangerouslySkipPermissions,
                 ...(sessionId ? { resume: sessionId } : {}) }
    })
    session.consumerTask = drain(session.query, ws)
  session.inputQueue.push(buildSDKUserMessage(message))
```

### Follow-up-message flow (same session, same project)

```
pushUserMessage(session, message, _ignoredSessionId):
  session.inputQueue.push(buildSDKUserMessage(message))
```

The client may still send `sessionId` on follow-ups (from localStorage). We ignore it mid-query — the SDK owns the transcript now. Client-side sessionId is only consulted on the **first** message of each session (server side), which is when `session.query === null`.

### Reconnect flow

If the client's WS drops and reopens (network blip, tab resume):

1. New WS, new empty `WsSession`.
2. Client sends its first message with `sessionId` from localStorage (already in current wiring — `App.tsx:23`).
3. Server seeds `query({prompt: iter, options: {cwd, resume: sessionId}})` — picks up the prior transcript.
4. Future messages on this WS reuse the query.

### Event consumption & final-text surfacing

The consumer (`drainQuery`) mirrors the current `runReal` body with one addition: track whether any `text` block was emitted since the last `result`. On `result`:

```ts
// Before yielding the result event:
if (r.subtype === "success" && typeof r.result === "string" && r.result.length > 0 && !textEmittedThisTurn) {
  // Stream the final text character-by-character so the UI's existing text reducer handles it.
  for (const ch of r.result) yield { type: "text", text: ch };
}
yield { type: "result", exitCode, duration };
textEmittedThisTurn = false;
```

`textEmittedThisTurn` is reset on every `result` event (end of a turn) and set to `true` whenever we yield a `type: "text"` event. This keeps the UI stream pure text — no new `WsEvent` variant, no client refactor.

### system.init passthrough

Unchanged. First `system.init` still yields `{type:"session", sessionId}` plus a `{type:"system", subtype:"init", ...}` passthrough. On subsequent turns there is no second init (the SDK doesn't re-init), so the session event is naturally single-fire.

## Components

| File | Role | Change |
|---|---|---|
| `apps/console/src/lib/pushQueue.ts` | New minimal `PushQueue<T>` (AsyncIterable + `push` + `done`) | create |
| `apps/console/src/orchestrator.ts` | `runReal` becomes `createSession(project, sessionId?) → {push, close, events}`; old one-shot `runReal` is deleted; `runMock` kept as fallback with same shape | rewrite |
| `apps/console/server.ts` | WS lifecycle: attach `WsSession` to each ws; on message route to `ensureSession + push`; on close → `session.close()` | modify |
| `apps/console/src/hooks/useWebSocket.ts` | No functional change; optional `console.debug("[ws]", event)` gate behind `import.meta.env.DEV` to aid diagnosis | optional touch-up |

No changes to `types.ts`, `ProjectContext.tsx`, `App.tsx`, or any component under `src/components/`.

### `orchestrator.ts` public surface

```ts
export interface AgentSession {
  push(message: string): void;
  close(): Promise<void>;
  events: AsyncIterable<WsEvent>;
  projectKey: string | null;
}

export function createSession(project?: string, resumeId?: string): AgentSession;

// Kept for tests / offline mode — same AgentSession shape, canned events.
export function createMockSession(project?: string): AgentSession;
```

### `server.ts` WS handlers

```ts
const sessions = new WeakMap<ServerWebSocket, WsSession>();

async open(ws) { sessions.set(ws, { project: null, session: null }); }

async message(ws, raw) {
  const payload = JSON.parse(raw as string);
  let slot = sessions.get(ws)!;
  if (slot.session && slot.project !== (payload.project ?? null)) {
    await slot.session.close();
    slot = { project: payload.project ?? null, session: null };
    sessions.set(ws, slot);
  }
  if (!slot.session) {
    slot.session = createSession(payload.project, payload.sessionId);
    slot.project = payload.project ?? null;
    // Start the forwarder task (single per session)
    void (async () => {
      for await (const ev of slot.session!.events) {
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(JSON.stringify(ev));
      }
    })();
  }
  slot.session.push(payload.message);
}

async close(ws) {
  const slot = sessions.get(ws);
  await slot?.session?.close();
  sessions.delete(ws);
}
```

## Data Contracts

### `SDKUserMessage` construction

Per SDK types (`sdk.d.ts:3228`):

```ts
function buildSDKUserMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}
```

`shouldQuery` defaults to `true`. `session_id` is filled in by the SDK on emit.

### `PushQueue<T>`

```ts
export class PushQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value, done: false });
    else this.buffer.push(value);
  }

  done(): void {
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!({ value: undefined as never, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length) return Promise.resolve({ value: this.buffer.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: async () => { this.done(); return { value: undefined as never, done: true }; },
    };
  }
}
```

### `AgentSession.close()` semantics

- Call `inputQueue.done()` so the SDK sees the stream end.
- `query.close()` on the SDK Query (forces subprocess teardown).
- Drain `consumerTask` so no events leak to a closed WS (guarded by `ws.readyState`).
- Idempotent.

## Error Handling

| Scenario | Behavior |
|---|---|
| SDK throws mid-turn (e.g., expired `resume` id) | `drainQuery` catches → yields `{type:"error", message}`; session becomes "dead" — next `push` re-initializes a new query (with no resume, new `session_id` flows) |
| WS abruptly closes during a live query | `close` handler calls `session.close()` → `inputQueue.done() + query.close()`. Forwarder loop's `ws.readyState` guard prevents writes on closed socket |
| Project switch mid-turn (payload.project changes) | Old session closed (awaits current turn abort via `query.close()`), new session seeded with new project + same `sessionId` (if provided — the client's localStorage key IS per-project, so mismatch is unlikely but safe) |
| Two WS frames arrive before first query is seeded | `push` queues into `inputQueue` before the SDK subprocess finishes booting; SDK drains both in order |
| `SDKResultSuccess.result` is empty string | We skip the synthetic-text fallback (preserve UI emptiness rather than fake content) |
| SDK emits a `result` with `is_error: true` or non-success subtype | exitCode=1 as today; UI's `onResult` callback still fires; the session stays alive — next push starts a new turn under the same query |

## Test Plan (manual)

Preconditions: existing test project in `workspace/` with a valid `pipeline-state.json`; `ANTHROPIC_API_KEY` or SDK auth configured.

1. **Smoke**: `bun run dev`, open browser, select project, send "你好". Expect: streaming text reply appears, then `result`.
2. **Multi-turn (warm)**: immediately send "刚才我说了什么". Expect: reply arrives perceptibly faster than turn 1 (no subprocess re-spawn) and correctly references "你好".
3. **Final-text surface**: send "请 Read workspace/<project>/pipeline-state.json 并用一句话总结". Expect: at least one text message appears AFTER the tool card. If tool-then-silence used to happen, this should now always show text.
4. **Cross-reconnect**: kill the server tab → restart `bun run dev` → refresh browser → re-send message. Expect: via localStorage sessionId, the assistant still recalls prior turns.
5. **Project switch**: switch to a different project in the switcher. Send a message. Expect: a fresh assistant turn (no memory of prior project), and a different `session_id` appears in the newly written localStorage slot.
6. **Explicit session clear**: `localStorage.removeItem('agentos:session:<project>')`, refresh, send. Expect: fresh session (no memory), new id persisted.
7. **Empty-result preservation**: ask the agent to do something that legitimately yields only tool output with no commentary (e.g., "Just Read this file, no summary"). Expect: if final `result.result` is empty, no synthetic text is injected — the UI correctly shows tool-only.
8. **WS disconnect mid-turn**: start a long turn, kill the dev server mid-stream. Expect: browser shows disconnected; reopening and resending does not leak prior events; server has no orphaned subprocess.
9. **Type-check + build**: `cd apps/console && bunx tsc --noEmit && bun run build`. Expect: both exit 0.

## Open Questions

None — user directive resolved the scope ("进行").

## Migration & Risk

- **Risk**: first-message latency unchanged (SDK must boot); subsequent-message latency drops drastically. User-visible perf profile shifts from "uniformly slow" to "first slow, rest fast" — worth calling out in any release notes.
- **Risk**: SDK `query.close()` timing — if called while a SDKMessage is mid-yield on the forwarder, we may lose a trailing event. Mitigation: the forwarder only reads via `for await`, which respects iterator return; closing the input queue then the query is the SDK-blessed path.
- **Backout**: revert the orchestrator/server refactor commits. Phase C-1 (session_id + resume) remains intact and functional.

## Follow-up (not in this spec)

- Surface `result.total_cost_usd` / `result.num_turns` in a status strip (Phase D/E).
- Expose `query.interrupt()` as a "停止" button in the chat composer.
- `console.debug` gated WS event log could graduate to an in-app devtool panel.
