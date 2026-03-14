# ChatJS UIUX Reuse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reuse the presentational UI/UX patterns from ChatJS in AgentOS-TS while preserving the current E2B sandbox runtime, JSON Lines protocol, and multi-agent routing model.

**Architecture:** Build a new `web/` frontend that borrows ChatJS's presentation layer only, and connect it to AgentOS-TS through a thin WebSocket bridge on the host side. Do not fork ChatJS's application shell; instead, extract or reimplement only the reusable UI primitives, then adapt them to a reducer-driven `SandboxEvent` state model.

**Tech Stack:** Bun, TypeScript, Next.js, Tailwind CSS, shadcn/ui, Streamdown, react-resizable-panels, WebSocket, existing E2B `SandboxClient`, existing `SandboxCommand` / `SandboxEvent` contract.

## Constraints and Non-Goals

- Keep the current E2B sandbox protocol as the source of truth.
- Do not adopt ChatJS backend dependencies such as `@ai-sdk-tools/store`, `tRPC`, `better-auth`, Redis, Postgres, or Drizzle.
- Do not force-fit AgentOS events into AI SDK `UIMessage` shapes.
- Keep the first iteration focused on chat, agent switching, tool visibility, and file preview.
- Defer ChatJS-specific artifact editing, project persistence, auth, sharing, and resumable AI SDK streams.

## Recommended Approach

### Option A — Recommended: New frontend, selective UI reuse

Create a dedicated `web/` app and selectively copy or restyle ChatJS presentational components.

**Why this is the best fit:**
- Preserves the existing E2B model and protocol.
- Minimizes architectural mismatch.
- Keeps the host/backend thin and maintainable.
- Lets you iterate on UX without inheriting ChatJS's data model.

### Option B — Partial fork of ChatJS app shell

Fork the ChatJS frontend app and strip store/auth/db/trpc incrementally.

**Why this is weaker:**
- Faster initial visuals, but long-term drag.
- High coupling to ChatJS's application state and routing assumptions.
- Large delete-and-rewrite surface.

### Option C — Rebuild the UX from scratch without borrowing code

Treat ChatJS as inspiration only and recreate the experience in AgentOS-TS.

**Why this is weaker:**
- Cleanest architecture, but slower.
- Misses the opportunity to reuse already-good interaction details.

## Reuse Boundary

### Safe to reuse directly or with light adaptation

- Chat container behavior inspired by `components/ai-elements/conversation.tsx`
- Markdown streaming rendering inspired by `components/ai-elements/response.tsx`
- Message bubble styling and action affordances inspired by `components/ai-elements/message.tsx`
- Split-pane layout inspired by `components/chat/chat-layout.tsx`
- shadcn/ui component inventory and spacing/tokens

### Reuse as reference only

- `components/messages.tsx`
- `components/assistant-message.tsx`
- `components/user-message.tsx`
- `components/app-sidebar.tsx`

These should be rewritten against AgentOS state and props.

### Do not reuse

- `components/multimodal-input.tsx`
- artifact/document/editor panels
- ChatJS API routes
- `@ai-sdk-tools/store` integrations
- `tRPC`, `better-auth`, Redis, Postgres, Drizzle, Vercel Blob bindings

## Target Architecture

```text
Browser (Next.js in web/)
  ├── Chat layout / tabs / preview panes
  ├── useSandboxConnection()  WebSocket client
  └── reducer(state, SandboxEvent)
            │
            ▼
Host Server (src/server.ts)
  ├── SandboxManager
  ├── WebSocket route /ws/:projectId
  ├── REST routes for files / metadata / sandbox lifecycle
  └── adapts WebSocket messages <-> SandboxClient.sendCommand()
            │
            ▼
E2B Sandbox
  ├── src/sandbox.ts
  ├── src/sandbox-orchestrator.ts
  └── stdout emits SandboxEvent JSON Lines
```

## State Model

The frontend should not model the UI around ChatJS's `UIMessage`. It should model the UI around the existing protocol and derive views from events.

Recommended browser-side state shape:

```ts
type UiState = {
  connection: "connecting" | "ready" | "disconnected" | "error";
  activeAgent: string | null;
  availableAgents: string[];
  sessions: Record<string, AgentTimeline>;
  pendingRequests: Record<string, PendingRequest>;
  selectedPreview: PreviewTarget | null;
};

type AgentTimeline = {
  messages: TimelineItem[];
  status: "idle" | "busy" | "disconnected";
  sessionId?: string;
};

type TimelineItem =
  | { kind: "user"; id: string; text: string; createdAt: number }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "tool_use"; id: string; tool: string }
  | { kind: "tool_log"; id: string; tool: string; phase: "pre" | "post"; detail?: Record<string, unknown> }
  | { kind: "system"; id: string; text: string }
  | { kind: "result"; id: string; cost: number; durationMs: number; isError: boolean };
```

This keeps the UI aligned with your actual transport and avoids a lossy compatibility layer.

## Implementation Tasks

### Task 1: Lock the protocol boundary for web use

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/protocol.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/server.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/protocol-extended.test.ts`

**Step 1: Ensure protocol supports all frontend actions**

- Confirm `chat`, `interrupt`, `status`, `list_skills`, `enter_agent`, `exit_agent`, and `resume` are the only required commands for v1.
- Confirm every event the frontend must render exists in `SandboxEvent`.

**Step 2: Add or tighten missing event fields only if required**

- Keep `request_id` and `agent` as the correlation mechanism.
- Avoid adding UI-specific event variants unless a gap is proven.

**Step 3: Verify protocol tests describe the web contract**

- Add parsing and serialization coverage for all command types.
- Add tests for event correlation assumptions.

**Validation:**
- Run: `bun test tests/protocol-extended.test.ts`
- Expect: command parsing and event typing remain backward-compatible.

### Task 2: Implement the host-side WebSocket bridge

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/server.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/sandbox-manager.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/src/session-store.ts`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/package.json`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/e2b-client.test.ts`

**Step 1: Introduce `SandboxManager` for project-scoped clients**

- Own the lifecycle of `SandboxClient` per project.
- Keep the API narrow: `getOrCreate`, `get`, `destroy`, `sendCommand`.

**Step 2: Add `/ws/:projectId` route in `src/server.ts`**

- Incoming WebSocket JSON should map 1:1 to `SandboxCommand`.
- Outgoing sandbox events should be forwarded unchanged.
- Do not invent a second frontend-specific protocol.

**Step 3: Add REST endpoints only for non-stream concerns**

- Sandbox lifecycle
- File listing/reading for preview
- Optional metadata endpoints

**Validation:**
- Run targeted tests around sandbox manager behavior.
- Manually verify a browser client can connect and receive `ready` and `status` events.

### Task 3: Scaffold the `web/` app with minimal surface area

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/package.json`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/next.config.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/tsconfig.json`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/postcss.config.mjs`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/layout.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/page.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/globals.css`

**Step 1: Keep `web/` independent from the backend build**

- Separate app, same repo.
- Use Bun for install and scripts.

**Step 2: Install only the minimum UI/runtime dependencies**

- `next`, `react`, `react-dom`
- `tailwindcss`
- `shadcn/ui` primitives as needed
- `streamdown`
- `react-resizable-panels`
- `use-stick-to-bottom`

**Step 3: Establish theme, layout shell, and responsive viewport rules**

- Default to a dark desktop-first workspace.
- Optimize for chat + tool inspection + preview, not mobile first.

**Validation:**
- Run `bun install` inside `web/`.
- Run the app and confirm the static shell renders without backend data.

### Task 4: Implement a browser-side transport + reducer instead of ChatJS store

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/protocol.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/hooks/use-sandbox-connection.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/hooks/use-sandbox-reducer.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/reduce-sandbox-event.ts`
- Test: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/reduce-sandbox-event.test.ts`

**Step 1: Mirror the protocol types in a browser-safe module**

- Prefer extracting a shared module later.
- For v1, keep duplication tiny and explicit if that reduces setup friction.

**Step 2: Build `useSandboxConnection()`**

- Connect, reconnect, send commands, surface connection state.
- Keep transport concerns out of UI components.

**Step 3: Build a pure reducer from `SandboxEvent` to `UiState`**

- Streaming text should append to the current assistant item.
- Tool events should become visible timeline items.
- History replay should rebuild timelines deterministically.

**Validation:**
- Reducer tests should cover `text`, `tool_use`, `tool_log`, `result`, `history`, `agent_entered`, `agent_exited`.

### Task 5: Port the reusable ChatJS presentation layer

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/chat/conversation.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/chat/message.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/chat/response.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/layout/chat-layout.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/ui/*`

**Step 1: Copy only presentation patterns, not data dependencies**

- Convert all components to props-only interfaces.
- Remove any `@ai-sdk-tools/store` assumptions.

**Step 2: Normalize AgentOS visual language**

- User and assistant messages should remain chat-like.
- Tool activity should be visibly distinct from assistant prose.
- System transitions such as agent switching should be treated as timeline events.

**Step 3: Preserve the best parts of ChatJS UX**

- auto stick-to-bottom
- rich markdown response rendering
- clean split-pane layout
- compact action affordances

**Validation:**
- Static story-like rendering with mocked props should look correct before wiring transport.

### Task 6: Build AgentOS-specific components ChatJS does not have

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/agents/agent-tabs.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/chat/tool-event.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/chat/system-event.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/chat/sandbox-input.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/preview/preview-pane.tsx`

**Step 1: Agent switching UI**

- Tabs or a compact switcher for `main` and named agents.
- Switching should be a deliberate command, not only a visual tab change.

**Step 2: Tool visualization UI**

- Show tool name, phase, and compact structured payload summary.
- Support collapse/expand for verbose tool detail.

**Step 3: Preview pane**

- Initial support: text, JSON, images, videos.
- File preview can come from dedicated REST endpoints.

**Validation:**
- Mocked event sequences should confirm that the timeline and preview pane remain coherent.

### Task 7: Wire the app end-to-end

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/page.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/app-shell.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/src/server.ts`

**Step 1: Build a single top-level app shell**

- Sidebar or agent rail
- Main chat timeline
- Secondary preview/inspection pane

**Step 2: Connect the shell to `useSandboxConnection()`**

- Send `chat`, `interrupt`, `status`, `list_skills`, `enter_agent`, `exit_agent`.
- Render server events directly through reducer-derived state.

**Step 3: Handle reconnection and history replay**

- When reconnecting, request status and replay history.
- Ensure the UI can survive socket drops without duplicating messages.

**Validation:**
- Manual scenario: connect → chat → tool call → result → enter agent → chat again → exit agent → reconnect.

### Task 8: Polish the UX without widening scope

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/**/*`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/globals.css`

**Step 1: Improve visual hierarchy**

- Stronger distinction between prose, tools, and system events.
- Better spacing, sticky input, empty states, and loading states.

**Step 2: Add keyboard-first interaction**

- Submit, interrupt, tab focus, and agent switch shortcuts.

**Step 3: Keep polish bounded**

- No auth, no shared links, no multi-project dashboard in v1.

**Validation:**
- Manual usability pass focused on long conversations and tool-heavy sessions.

## Testing Plan

### Unit tests

- reducer tests for `SandboxEvent -> UiState`
- protocol tests for command parsing and event shape stability
- view-model tests for grouping streamed assistant chunks

### Integration tests

- server bridge test with mocked `SandboxClient`
- connect/send/receive test covering WebSocket lifecycle

### Manual checks

- long markdown response rendering
- tool-heavy turn rendering
- agent enter/exit transitions
- reconnect and history recovery
- preview of image/video/json/text outputs

## Sequencing Recommendation

Execute in this order:

1. Protocol boundary
2. Host-side WebSocket bridge
3. `web/` scaffold
4. Browser reducer and transport
5. Reusable ChatJS presentation layer
6. AgentOS-specific UI components
7. End-to-end wiring
8. UX polish

This order de-risks the project by locking the transport contract before styling work.

## Risks and Mitigations

### Risk 1: Over-copying ChatJS and inheriting hidden coupling

**Mitigation:** Treat ChatJS as a component library reference, not an app template.

### Risk 2: Frontend state drifting from actual protocol behavior

**Mitigation:** Make reducer tests the center of truth and forward sandbox events unchanged.

### Risk 3: File preview scope exploding

**Mitigation:** Keep v1 preview read-only and support only common file types.

### Risk 4: WebSocket bridge becoming a second orchestrator

**Mitigation:** Keep the server thin; all agent logic remains in sandbox-orchestrator.

## Definition of Done for V1

- A browser client can connect to an E2B-backed project and render a usable chat workspace.
- User can send chat messages, interrupt, inspect tool activity, switch agents, and see history.
- UI visually feels close to ChatJS in quality, but is driven entirely by AgentOS protocol and state.
- No ChatJS runtime dependency is required for store, auth, DB, or backend routes.

## Suggested Execution Split

- **Backend first:** protocol tightening, `SandboxManager`, `server.ts`, file preview endpoints.
- **Frontend second:** `web/` scaffold, reducer, connection hook.
- **UX third:** ChatJS-derived presentation components and AgentOS-specific panels.

Plan complete and saved to `docs/plans/2026-03-10-chatjs-uiux-reuse-plan.md`.

Two execution options:

1. **Subagent-Driven (this session)** — implement task-by-task here, reviewing each stage.
2. **Parallel Session (separate)** — open a fresh execution session against this plan and batch through the tasks.
