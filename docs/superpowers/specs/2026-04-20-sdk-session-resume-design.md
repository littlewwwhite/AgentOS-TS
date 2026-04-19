# SDK Session Resume & Event Passthrough Design

**Status:** Draft · 2026-04-20
**Scope:** `apps/console/` frontend + WS server
**Phase:** C of the console rebuild (follows A: StageNode bug fix; precedes B: theme tokens, D: chat UI, E: taste pass)

## Goal

Fix the current "every WS message starts a fresh session" bug by plumbing the Claude Agent SDK's native `session_id` / `resume` mechanism end-to-end. Bypass all tool permissions by default. Widen the WS event channel so the frontend can receive any `SDKMessage` subtype without orchestrator changes.

## Non-Goals

- No bidirectional WS protocol. No `canUseTool` callback. No permission-request UI.
- No use of the SDK's `unstable_v2_createSession` API.
- No changes to Navigator / Viewer / StageNode / EpisodeNode components.
- No changes to skills, MCP servers, or pipeline-state.json writer logic.
- No new per-message state beyond `session_id`.

## Invariants (must not regress)

1. `cwd` passed to `query()` stays `join(PROJECT_ROOT, "workspace", project)`. User-generated artifacts must continue to land in their per-project workspace. `PROJECT_ROOT` constant untouched.
2. Skills, MCP servers, and pipeline stage semantics unchanged.
3. `workspace/${project}/` layout unchanged — no new files written by this phase.
4. WS URL path, WS open/close lifecycle, and existing `send({ message, project })` call sites remain valid (additive changes only).
5. Navigator weak-follow (tool_result → unread badge) keeps working.

## Architecture

Single-direction WS (client → server: one request; server → client: event stream). Session continuity provided by SDK's `resume` option keyed off a `session_id` the SDK emits in its `system.init` event.

```
Client                                  Server                                SDK
──────                                  ──────                                ───
send({message, project, sessionId?})──▶ runAgent(message, project, sid)──▶   query({
                                                                               cwd,
                                                                               permissionMode: 'bypassPermissions',
                                                                               allowDangerouslySkipPermissions: true,
                                                                               resume: sid,        ← if present
                                                                             })
                                        for await (msg of ...)           ◀── SDKMessage stream
                                        if msg.type==='system'&&subtype==='init':
                                          yield {type:'session', sessionId}
                                        yield {type:'system', ...}       ──▶ ProjectContext.setSessionId
                                        yield {type:'text'|'tool_use'|
                                              'tool_result'|'result', ...}
on ws message:
  if type==='session':
    localStorage[key] = sessionId
    setSessionId(sessionId)
```

### Session lifecycle

- **New project**: no sessionId yet; first request has no `resume`; server yields `session` event on `system.init`; client persists.
- **Same project, follow-up message**: client sends stored `sessionId`; server passes `resume: sessionId`; SDK continues prior turn.
- **Session expired / invalid**: SDK throws; orchestrator catches → yields `error` → client clears `localStorage[key]` and user can retry (which starts fresh).
- **Browser refresh**: localStorage re-hydrates sessionId on ProjectContext mount.
- **Switch project**: ProjectContext keys by project name, reads new localStorage slot.

## Components

| File | Responsibility | Change |
|---|---|---|
| `apps/console/src/types.ts` | `WsEvent` union | extend |
| `apps/console/src/orchestrator.ts` | Inject `permissionMode`, optional `resume`; intercept `system.init`; passthrough system events | modify |
| `apps/console/server.ts` | Accept `sessionId` in inbound message; forward to `runAgent` | modify |
| `apps/console/src/contexts/ProjectContext.tsx` | Own `sessionId` state; persist via localStorage keyed by project | modify |
| `apps/console/src/hooks/useWebSocket.ts` | Attach `sessionId` on send; expose `onSession` callback | modify |
| `apps/console/src/components/Chat/Chat.tsx` (or current chat host) | Wire `onSession` → `ProjectContext.setSessionId`; read `sessionId` for outgoing send | modify |

## Data Contracts

### WS inbound (client → server)

```ts
{
  message: string;
  project: string;
  sessionId?: string;   // new, optional
}
```

### WS outbound (server → client)

```ts
type WsEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; tool: string; input: unknown }
  | { type: "tool_result"; id: string; tool: string; output: string; path?: string }
  | { type: "result"; exitCode: number; duration: number }
  | { type: "system"; subtype: string; data: unknown }
  | { type: "error"; message: string };
```

Unknown `SDKMessage` subtypes not explicitly mapped are forwarded as `{type:"system", subtype, data}` — lossless passthrough, future additions require no server change.

### orchestrator signature

```ts
export async function* runReal(
  message: string,
  project?: string,
  sessionId?: string,   // new
): AsyncGenerator<WsEvent>;
```

### orchestrator query options

```ts
{
  cwd,                                   // unchanged: workspace/${project}
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true, // SDK JSDoc: bypassPermissions requires this
  ...(sessionId ? { resume: sessionId } : {}),
}
```

### localStorage key

`agentos:session:${projectName}`

Value: string (`sessionId`). Missing / unparsable → treated as no session.

## Error Handling

| Scenario | Behavior |
|---|---|
| `sessionId` expired/invalid; SDK throws | orchestrator `catch` → yield `{type:"error", message}`; client clears localStorage slot; next send starts fresh |
| `system.init` missing `session_id` field | Skip `session` yield; log to server stderr; proceed with all other passthrough |
| `localStorage` unavailable (private mode) | ProjectContext falls back to in-memory state; feature works per-tab, loses cross-refresh continuity |
| WS reconnect mid-turn | Server drops the stream; client reopens with existing sessionId on next send; resumes from last persisted state |
| Two tabs same project | Both read same localStorage key; last writer wins. Acceptable — session sharing is an SDK concern, not ours |

## Test Plan (manual)

1. `bun run dev` console app.
2. Create / open a project, send "我叫小明".
3. Send "我叫什么" — assistant should recall "小明".
4. Refresh browser, re-open same project, send "我叫什么" — should still recall.
5. `localStorage.removeItem("agentos:session:<project>")` in DevTools; send again — assistant should NOT recall (new session).
6. DevTools → Network → WS frames: confirm outbound frames include `sessionId` after first turn.
7. Console: confirm no "Allow tool …" prompts surface (bypassPermissions working).
8. Trigger a write tool (e.g., ask the agent to create a file under `workspace/<project>/`) — confirm file lands in that workspace, nowhere else.
9. Switch to a different project; confirm fresh session (different localStorage slot) and first turn has no memory of project #1.

## Open Questions

None — user directive ("默认开启全部权限 + 尽量直接使用 SDK 自带逻辑") resolves the key scope question.

## Follow-up Phases (not in this spec)

- **B**: theme tokens (CSS variables, light theme)
- **D**: chat UI — `askUserQuestion` renderer, session indicator, notification surface
- **E**: taste / ui-ux-designer pass for palette & spacing tokens
