# E2B-Powered Agent Architecture — Panoramic Analysis

> Date: 2026-03-09
> Branch: master
> Status: Analysis complete

## 1. System Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Host (macOS / Server)                       │
│                                                                     │
│  ┌──────────────┐   ┌──────────────────┐   ┌─────────────────────┐ │
│  │ bun start    │   │ bun start:e2b    │   │ bun server          │ │
│  │ (index.ts)   │   │ (e2b-repl.ts)    │   │ (server.ts)         │ │
│  │ Local REPL   │   │ E2B Terminal     │   │ HTTP + WebSocket    │ │
│  │              │   │ REPL             │   │ API Bridge          │ │
│  │ orchestrator │   │       ↓          │   │       ↓             │ │
│  │ .ts (query)  │   │ SandboxClient    │   │ SandboxClient       │ │
│  └──────────────┘   │ (e2b-client.ts)  │   │ (e2b-client.ts)     │ │
│                     └────────┬─────────┘   └────────┬────────────┘ │
│                              │ stdin/stdout          │              │
│                              │ JSON Lines            │              │
└──────────────────────────────┼──────────────────────┼──────────────┘
                               │                      │
                     ┌─────────▼──────────────────────▼──────────┐
                     │              E2B Sandbox                   │
                     │  /home/user/app/                           │
                     │  ┌──────────────────────────────────────┐ │
                     │  │ sandbox.ts (entry)                    │ │
                     │  │  ├── stdin → parseCommand()           │ │
                     │  │  └── SandboxOrchestrator              │ │
                     │  │       ├── main worker (queue)         │ │
                     │  │       ├── agent-A worker (queue)      │ │
                     │  │       └── agent-B worker (queue)      │ │
                     │  │           ↓                           │ │
                     │  │       query() → Claude API            │ │
                     │  │       (with queryLock mutex)          │ │
                     │  └──────────────────────────────────────┘ │
                     │  /home/user/app/workspace/                 │
                     │  /home/user/app/skills/                    │
                     │  /home/user/app/agents/                    │
                     └───────────────────────────────────────────┘
```

## 2. Three Entry Paths

| Dimension | `bun start` (local) | `bun start:e2b` (E2B terminal) | `bun server` (Web UI) |
|:----------|:--------------------|:-------------------------------|:----------------------|
| Entry file | `src/index.ts` → `orchestrator.ts` | `scripts/e2b-repl.ts` | `src/server.ts` |
| Agent runs at | Local process | E2B cloud sandbox | E2B cloud sandbox |
| Protocol | Direct function call | JSON Lines over stdin/stdout | WebSocket → JSON Lines |
| User interface | Terminal readline | Terminal readline | React Web UI |
| State mgmt | `orchestrator.ts` internal | `SandboxOrchestrator` (in sandbox) | Same as E2B |
| File system | Local `workspace/` | Sandbox `/home/user/app/workspace/` | Same as E2B |
| Session resume | `--resume` / `--continue` | Not implemented | Not implemented |

## 3. Core Module Responsibilities

### 3.1 SandboxClient (`src/e2b-client.ts`) — Host-side E2B Bridge

**Lifecycle:**
- `start()` → `Sandbox.create()` → `startProcess()` → `startHeartbeat()`
- `connect(sandboxId)` → Attach to existing sandbox
- `destroy()` → Stop heartbeat → kill process → kill sandbox

**Communication:**
- Downstream: `sendCommand()` → `sendStdin(pid, JSON + "\n")`
- Upstream: `onStdout` → `handleStdout()` line-split → `JSON.parse` → `eventCb(event)`
- `lineBuffer` handles TCP fragmentation

**Resilience layer:**
- Heartbeat: 60s interval, calls `sandbox.setTimeout()` to extend lifetime + sends `status` ping
- Auto-reconnect: Process exit/crash → `tryReconnect()` up to 3 times, exponential backoff (1s/2s/4s, max 10s)
- Sandbox recreation: Reconnect detects `sandbox.isRunning()` failure → `Sandbox.create()` new instance

### 3.2 SandboxOrchestrator (`src/sandbox-orchestrator.ts`) — In-Sandbox Core

**Multi-agent architecture:**
- 1 `mainSession` (orchestrator identity) + N agent sessions
- Each session: independent `AsyncQueue<{prompt, requestId}>` + `busy` flag
- `startWorkers()` spawns a perpetual polling worker per session

**Request routing:**
- `resolveTarget(cmd)` → `cmd.target` priority → fallback `activeAgent`
- `chat(message, target, requestId)` → push to target session queue

**SDK call serialization:**
- `queryLock` mutex — only one `query()` globally at any time
- Reason: SDK shares a single MCP Protocol instance, cannot handle concurrent connections

**Agent context switching:**
- `enterAgent(name)` → set `_activeAgent`, subsequent chat routes to that agent
- `exitAgent()` → clear `_activeAgent`, messages return to main session

### 3.3 sandbox.ts — Sandbox Entry (Thin Adapter)

- Parses CLI args: `bun sandbox.js <projectPath> --skills <dir>`
- Cleans host env vars (removes `CLAUDECODE`, localhost `ANTHROPIC_BASE_URL`)
- Initializes `SandboxOrchestrator` → stdin readline → `parseCommand()` → dispatch
- Crash guard: `uncaughtException` / `unhandledRejection` → emit error → exit(1)

### 3.4 Protocol (`src/protocol.ts`) — Communication Contract

**7 command types** (stdin → sandbox):
`chat` | `interrupt` | `status` | `list_skills` | `enter_agent` | `exit_agent` | `resume`

**10 event types** (sandbox → stdout):
`ready` | `text` | `tool_use` | `tool_log` | `result` | `error` | `status` | `skills` | `agent_entered` | `agent_exited`

All events carry optional `request_id` + `agent` fields for concurrent correlation.

**Natural language agent entry** (`matchEnterAgent`):
Matches `进入X` / `切换到X` / `enter X` / `switch to X` — used in e2b-repl.ts only.

### 3.5 Agent Build Pipeline

```
agents/*.yaml  →  loadAgentConfigs()  ─┐
                                        ├──→  buildAgents()  ──→  AgentDefinitionConfig
skills/*/SKILL.md  →  loadSkillContents()  ─┘        │
                                                      ↓
                                              buildOptions()  ──→  SDK options
                                                      │
                                              ┌───────┴───────┐
                                              │ systemPrompt   │  orchestrator prompt
                                              │ agents         │  sub-agent definitions
                                              │ mcpServers     │  auto-inferred from tools
                                              │ hooks          │  sandbox hooks
                                              │ allowedTools   │  tool whitelist
                                              └────────────────┘
```

Key details:
- Agent prompt = Role identity + workspace path + SKILL.md full text + Domain Skills summary
- `buildAgentOptions()` sets `agents: undefined`, `settingSources: []` to prevent agent recursion
- MCP server names auto-extracted from `mcp__<server>__<tool>` patterns in `allowed-tools`
- `configuredSkills` preserves original skill names for orchestrator skill→agent routing

### 3.6 Template Build (`e2b/build.ts`)

```
Template.fromBunImage("1.3")
  → makeDir(/home/user/app)
  → copy package.json → bun install (Linux native)
  → copy dist/ + skills/ + agents/
  → makeDir(workspace/)
```

Default entrypoint: `bun /home/user/app/dist/sandbox.js /home/user/app/workspace --skills /home/user/app/skills`

## 4. Data Flow Example

User input "帮我写个剧本大纲" via E2B REPL:

```
[Terminal]  "帮我写个剧本大纲"
    ↓ readline
[e2b-repl.ts]  client.chat("帮我写个剧本大纲")
    ↓ sendCommand({ cmd: "chat", message: "..." })
    ↓ sandbox.commands.sendStdin(pid, JSON line)
[E2B sandbox stdin]
    ↓ parseCommand(line)
[sandbox.ts]  orchestrator.chat("帮我写个剧本大纲", null)
    ↓ mainSession.queue.push(...)
[SandboxOrchestrator]  runWorker → processQuery
    ↓ queryLock acquire
    ↓ query({ prompt, options })
[Claude API]  → streaming response
    ↓ stream_event / tool_progress / result
[SandboxOrchestrator]  emit({ type: "text", text: "..." })
    ↓ process.stdout.write(JSON line)
[E2B sandbox stdout]
    ↓ onStdout → handleStdout → lineBuffer → JSON.parse
[SandboxClient]  eventCb(event)
    ↓
[e2b-repl.ts]  handleEvent(event) → process.stdout.write(text)
    ↓
[Terminal]  streaming text displayed
```

## 5. Known Issues & Improvement Opportunities

| # | Issue | Impact | Recommendation |
|:--|:------|:-------|:---------------|
| 1 | `buildAgentOptions` sets `agents: undefined` | Sub-agent SDK query cannot find its own definition, may degrade to bare Claude | Keep `{ [name]: selfDef }` instead of `undefined` |
| 2 | `queryLock` global serialization | Multi-agent cannot query in parallel; main blocks all agents | SDK-level multi MCP Protocol support, or split to multi-process |
| 3 | `resume` command not implemented | E2B session recovery unavailable | Persist session_id to sandbox filesystem |
| 4 | WebSocket layer only passes `chat` / `interrupt` | `enter_agent`, `exit_agent`, `list_skills` not accessible from Web UI | Extend server.ts switch-case for all commands |
| 5 | Heartbeat `setTimeout()` failure silently caught | Sandbox may expire without warning | Emit warning event in heartbeat `.catch()` |
| 6 | Template doesn't pin dist/ version | Local code and sandbox code may diverge | Write git hash at build time, report on sandbox startup |

## 6. Architecture Strengths

1. **Unified protocol**: Local, E2B, and Web UI all share the same SandboxCommand/SandboxEvent contract
2. **Resilience design**: Heartbeat + exponential backoff reconnect + sandbox recreation covers both process crash and sandbox expiry
3. **Agent isolation**: Each agent has independent queue + worker; orchestrator does routing — single responsibility
4. **Skill composition**: Agent config declares skill names → SKILL.md auto-injected into prompt — domain knowledge hot-swap
5. **MCP auto-inference**: MCP server dependencies extracted from `allowed-tools` patterns — no manual maintenance
