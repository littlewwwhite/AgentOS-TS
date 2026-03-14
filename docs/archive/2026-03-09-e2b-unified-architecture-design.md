# E2B Unified Architecture Design

Eliminate local REPL mode. Unify all execution on E2B cloud sandbox.
Physical isolation replaces software-level permission checks.

## Motivation

Local mode has structural flaws that cannot be fixed:

1. **Bash interception is an arms race** — `permissions.ts` tries to detect write
   operations via regex (`extractBashWriteTargets`), but every new shell command
   (sed -i, symlink, sub-shell) introduces a bypass path. User-space emulation of
   kernel-level isolation is fundamentally fragile.
2. **Native agent experience conflicts with local safety** — removing soft
   interception gives agents full capability but makes local execution unsafe.
3. **Two modes double maintenance** — `orchestrator.ts` (REPL) and `sandbox.ts`
   share `buildOptions()` but diverge on hooks, permissions, and protocol support.

E2B sandbox provides the correct isolation layer: physical boundary, resource
limits, disposable environment. Designing for E2B as the sole runtime simplifies
the architecture and unlocks native Claude Code capabilities for agents.

## Architecture

```
Frontend / API consumers
    │  SSE + REST
    ▼
Hono API Server  (src/server.ts)  ← bun start
    │
    │  SandboxManager
    │    ├── clients: Map<projectId, SandboxClient>
    │    └── store: SessionStore (.agentos/sessions/)
    │
    │  E2B SDK (create / connect / stdin / stdout)
    ▼
E2B Sandbox  (src/sandbox.ts → thin protocol adapter)
    │
    │  SandboxOrchestrator  (sole orchestration core)
    │    ├── mainSession (orchestrator itself)
    │    ├── agents: Map<name, AgentSession>
    │    │     └── independent queue + worker + sessionId
    │    ├── hooks: schema + budget + logger
    │    ├── handleCommand() ← stdin JSON
    │    └── emit() → stdout JSON
    │
    │  /home/user/app/
    │    ├── dist/    (compiled framework)
    │    ├── agents/  (*.yaml configs)
    │    ├── skills/  (*/SKILL.md)
    │    └── workspace/ (project files)
```

## Core Design Decisions

### 1. SandboxOrchestrator — sole orchestration core

Single class that owns all agent state and routing logic. Replaces both
`orchestrator.ts` (REPL) and the current `sandbox.ts` worker loop.

```typescript
class SandboxOrchestrator {
  private agents: Map<string, AgentSession>;
  private mainSession: AgentSession;
  private activeAgent: string | null = null;
  private hooks: HookSet;

  handleCommand(cmd: SandboxCommand): void;  // protocol dispatch
  routeChat(cmd: ChatCommand): void;         // target > activeAgent > main
  enterAgent(name: string): void;            // persistent switch
  exitAgent(): void;                         // back to main
  start(): Promise<void>;                    // launch all workers in parallel
}
```

Each `AgentSession` has:
- Independent `AsyncQueue<ChatRequest>` + `runWorker()` loop
- Own `sessionId` for SDK session persistence
- Own `options` derived from `buildOptions()` + agent config

Routing priority: `cmd.target > this.activeAgent > mainSession`.

### 2. Protocol extensions

New commands:

| Command | Purpose |
|---------|---------|
| `enter_agent` | Persistently switch active agent context |
| `exit_agent` | Return to main orchestrator |
| `resume` | Resume a previous session by ID |

Extended `chat` command:

```typescript
type ChatCommand = {
  cmd: "chat";
  message: string;
  request_id?: string;  // correlate responses in concurrent scenarios
  target?: string;      // one-shot routing without state change
};
```

New events:

| Event | Purpose |
|-------|---------|
| `agent_entered` | Confirms agent switch, includes session_id |
| `agent_exited` | Confirms return to main |

All events gain optional `request_id` and `agent` fields for concurrent
response correlation. Backward-compatible — absent fields preserve current
behavior.

### 3. Sandbox-only hooks

E2B mode retains three hooks for data quality and cost control. All
permission-related hooks are deleted.

| Hook | Type | Purpose |
|------|------|---------|
| `schemaValidator` | PreToolUse | Validate structured data writes against Zod schemas |
| `budgetGuard` | PreToolUse | Per-agent-session cost tracking, deny on threshold |
| `toolLogger` | PostToolUse | Emit structured tool_log events for observability |

Deleted hooks: `canUseTool` (Bash interception), `filePolicy` checks,
`todoNag` (REPL-specific).

### 4. Per-agent options derivation

```typescript
private buildAgentOptions(name, agentConfig, baseOptions) {
  return {
    ...baseOptions,
    systemPrompt: { type: "preset", preset: "claude_code", append: agentPrompt },
    allowedTools: agentConfig.allowedTools ?? baseOptions.allowedTools,
    maxBudgetUsd: agentConfig.maxBudgetUsd ?? 5.0,
    agents: undefined,  // prevent infinite recursion at SDK level
  };
}
```

Setting `agents: undefined` on sub-agents prevents recursive Agent tool
calls at the SDK level — more reliable than prompt-level disallow.

### 5. SandboxManager (host side)

```typescript
class SandboxManager {
  private clients: Map<string, SandboxClient>;
  private store: SessionStore;

  create(projectId, opts): Promise<SandboxClient>;
  reconnect(projectId): Promise<SandboxClient | null>;
  destroy(projectId): Promise<void>;
  get(projectId): SandboxClient | null;
}
```

Replaces global singleton `client` in current `server.ts`. Supports
multiple concurrent projects.

### 6. SessionStore

File-based persistence at `.agentos/sessions/<projectId>.json`.

```typescript
interface SessionState {
  sandboxId: string;
  agentSessions: Record<string, string>;  // agent name → session_id
  createdAt: number;
}
```

Enables server restart without losing sandbox connections.

### 7. Parameterized routes

```
POST   /api/sandbox/:id/start
DELETE /api/sandbox/:id
POST   /api/sandbox/:id/chat
POST   /api/sandbox/:id/enter_agent
POST   /api/sandbox/:id/exit_agent
GET    /api/sandbox/:id/events  (SSE)
GET    /api/sandbox/:id/status
GET    /api/sandbox/:id/files
GET    /api/sandbox/:id/file
```

## File Changes

### Delete

| File | Reason |
|------|--------|
| `src/index.ts` | REPL entry point, replaced by server.ts |
| `src/orchestrator.ts` | REPL logic, orchestration moves to sandbox-orchestrator.ts |
| `src/permissions.ts` | Soft interception, sandbox is the boundary |

### Create

| File | Purpose |
|------|---------|
| `src/sandbox-orchestrator.ts` | Sole orchestration core |
| `src/sandbox-manager.ts` | Host-side multi-project management |
| `src/session-store.ts` | File-based session persistence |

### Refactor

| File | Changes |
|------|---------|
| `src/sandbox.ts` | Thin protocol adapter over SandboxOrchestrator |
| `src/server.ts` | SandboxManager + parameterized routes |
| `src/protocol.ts` | Extended commands and events |
| `src/hooks/index.ts` | Simplified to buildSandboxHooks() |
| `e2b/build.ts` | Add agents/ directory to template |
| `package.json` | `"start": "bun src/server.ts"` |

### Unchanged

| File | Reason |
|------|--------|
| `src/agents.ts` | Agent config composition — still needed |
| `src/loader.ts` | YAML/SKILL loading — still needed |
| `src/tools/*` | MCP tool definitions — still needed |
| `src/schemas/*` | Zod schemas — still needed |
| `src/e2b-client.ts` | E2B SDK wrapper — still needed |

## Implementation Phases

### Phase 1: Core Orchestration

Goal: SandboxOrchestrator works end-to-end in E2B.
Validation: `scripts/e2b-smoke.ts` passes with agent routing.

1. Extract `buildOptions()` from orchestrator.ts, remove REPL-specific logic
   (mode, canUseTool, @file expansion, slash commands)
2. Implement `SandboxOrchestrator` class (agent routing, multi-queue workers,
   hooks integration)
3. Extend `protocol.ts` (enter_agent, exit_agent, target, request_id)
4. Refactor `sandbox.ts` to thin adapter over SandboxOrchestrator
5. Implement `buildSandboxHooks()` (schemaValidator, budgetGuard, toolLogger)
6. Delete `permissions.ts`
7. Update `e2b/build.ts` (add agents/ directory)
8. End-to-end validation with e2b-smoke.ts

### Phase 2: Server API

Goal: server.ts supports multi-project management, frontend can connect.
Validation: frontend can create project, chat, switch agents.

1. Implement `SandboxManager` (multi-project Map)
2. Implement `SessionStore` (file-based persistence)
3. Parameterize routes to `/api/sandbox/:projectId/*`
4. Add enter_agent / exit_agent REST endpoints
5. Add agent / request_id fields to SSE events
6. Delete `orchestrator.ts` and `index.ts`
7. Update `package.json` entry point

### Phase 3: Developer Experience

Goal: Mitigate E2B-only iteration overhead.
Validation: YAML/SKILL change does not require sandbox rebuild.

1. Sandbox reuse — keep-alive across connections, reattach to running sandbox
2. File hot-sync — watch agents/ + skills/ locally, sync via
   `sandbox.files.write()` to running sandbox
3. CLI management — `bun run sandbox:create / sandbox:list / sandbox:sync`
4. In-sandbox hot reload — detect agents/*.yaml changes, re-run
   `loadAgentConfigs()` without process restart

## Comparison: AgentOS-TS (unified E2B) vs e2b-claude-agent

| Dimension | AgentOS-TS | e2b-claude-agent |
|-----------|-----------|-----------------|
| Sandbox core | ~150 lines thin adapter + SandboxOrchestrator | ~300 lines orchestrator.py state machine |
| Agent routing | Protocol-level enter/exit/target + per-agent queue | Manual disconnect/reconnect client switching |
| Agent config | Declarative YAML + composable SKILL.md | Filesystem .claude/ per directory |
| Concurrency | Independent worker per agent, true parallel | Single active agent, sequential switching |
| SDK usage | Native query() per agent session | Native query() but with manual lifecycle |
| Hooks | Schema validation + budget guard + tool logger | None |
| Session recovery | SessionStore + SDK resume | SDK resume + orchestrator state dict |
| Pipeline mode | Not needed — orchestrator dispatches via Agent tool | Explicit run_pipeline() with stage validation |
| Template build | Programmatic Template() API | Programmatic Template() API |
| Resource | 2 CPU / 2 GB | 4 CPU / 4 GB |
| Local dev | Phase 3 hot-sync mitigates iteration overhead | No local mode |

Key architectural difference: e2b-claude-agent puts orchestration intelligence
in custom Python code (state machine for master/stage switching).
AgentOS-TS puts orchestration intelligence in the LLM (via Agent tool dispatch)
and keeps the framework minimal — protocol routing + data quality hooks.
