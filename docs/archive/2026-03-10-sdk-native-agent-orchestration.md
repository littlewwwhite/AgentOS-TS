# SDK-Native Agent Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework Agent scheduling so the project uses Claude Agent SDK native semantics for permissions, budget, hooks, and MCP exposure, while keeping custom orchestration only where the SDK cannot model per-agent filesystem isolation.

**Architecture:** Keep `SandboxOrchestrator` as the transport/session multiplexer because the SDK's programmatic `AgentDefinition` cannot express per-agent `cwd` plus `settingSources` loading from separate `agents/<name>/.claude/` directories. Move everything else back toward SDK-native behavior: explicit session specs for `main` vs worker agents, least-privilege MCP exposure per session, SDK-native `maxBudgetUsd`, hook metadata from `HookInput`, and one manifest loader that defines routing metadata once.

**Tech Stack:** Bun, TypeScript, Claude Agent SDK, in-process SDK MCP servers, Vitest

---

## SDK References To Re-Read Before Implementation

- `docs/claude-agent-sdk-ts.md:192-232`
  Why: `Options` semantics for `allowedTools`, `disallowedTools`, `permissionMode`, `maxBudgetUsd`, `mcpServers`, `settingSources`
- `docs/claude-agent-sdk-ts.md:306-339`
  Why: `AgentDefinition` limits explain why we keep custom session routing
- `docs/claude-agent-sdk-ts.md:360-440`
  Why: `settingSources` and precedence between filesystem settings and programmatic options
- `docs/claude-agent-sdk-ts.md:807-980`
  Why: hook inputs already include `session_id`, `agent_id`, `agent_type`, `cwd`
- `docs/claude-agent-sdk-ts.md:255-284`
  Why: session-level MCP lifecycle APIs and the shape of native MCP management

## Target End State

- `main` session is a real dispatcher:
  only the `switch` MCP server plus a minimal built-in tool surface, no domain MCP servers
- worker agents get their role, skills, and permissions from `agents/<name>/.claude/`
- routing metadata, skill tags, and MCP exposure are loaded from one manifest layer, not duplicated by hand across unrelated files
- hook logic reads SDK-native hook metadata instead of relying on outer closures for agent identity
- custom budget guard is removed in favor of SDK-native `maxBudgetUsd`
- session history restore works for resumed lazy agents, not only for `main`

## Non-Goals

- Do not replace custom multi-session routing with the SDK `Agent` tool
- Do not redesign the web protocol or the chat UI reducer
- Do not move agent prompts out of `.claude/`

### Task 1: Lock The Desired SDK Semantics In Tests

**Files:**
- Modify: `tests/options.test.ts`
- Modify: `tests/agent-options.test.ts`
- Modify: `tests/sandbox-orchestrator.test.ts`

**Step 1: Write the failing tests**

Add tests that express the new contract:

```ts
it("main options expose only dispatch-safe MCP servers", async () => {
  const opts = await buildOptions("/tmp/test-ws", "agents");
  expect(Object.keys(opts.mcpServers as Record<string, unknown>)).toEqual([]);
  expect(opts.permissionMode).toBe("default");
  expect(opts.disallowedTools).toEqual(expect.arrayContaining(["Bash", "Write"]));
});

it("agent options do not inherit main permission and hook policy", async () => {
  const opts = await buildAgentOptions(
    BASE_OPTIONS,
    "/agents",
    "/workspace",
    "screenwriter",
  );
  expect(opts.allowedTools).toBeUndefined();
  expect(opts.disallowedTools).toBeUndefined();
  expect(opts.permissionMode).toBeUndefined();
  expect(opts.hooks).toBeUndefined();
});

it("resumed lazy agents emit history when instantiated", async () => {
  // Write .sessions.json with a persisted agent session and assert
  // history is emitted after the lazy agent is created.
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/options.test.ts tests/agent-options.test.ts tests/sandbox-orchestrator.test.ts
```

Expected: FAIL because `buildOptions()` still injects domain MCP servers and bypass permissions, `buildAgentOptions()` still inherits main session policy, and lazy-agent history is not replayed.

**Step 3: Write the minimal implementation**

Make the tests fail for the right reason before broader refactors:

- keep the old implementation untouched for now
- only add the new expectations and any tiny test helpers needed for `.sessions.json`

Test helper sketch:

```ts
function writeSessionsFile(dir: string, data: Record<string, string>) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".sessions.json"), JSON.stringify(data));
}
```

**Step 4: Run tests to verify the failure is targeted**

Run:

```bash
bun test tests/options.test.ts tests/agent-options.test.ts tests/sandbox-orchestrator.test.ts
```

Expected: FAIL only on the new expectations, without unrelated snapshot or syntax failures.

**Step 5: Commit**

```bash
git add tests/options.test.ts tests/agent-options.test.ts tests/sandbox-orchestrator.test.ts
git commit -m "test: lock sdk-native orchestration semantics"
```

### Task 2: Introduce A Single Agent Manifest Layer

**Files:**
- Create: `src/agent-manifest.ts`
- Create: `tests/agent-manifest.test.ts`
- Modify: `src/loader.ts`
- Modify: `src/options.ts`

**Step 1: Write the failing test**

Create a manifest test that proves skills are discovered from disk and not only from YAML:

```ts
it("loads skill names from .claude/skills and merges routing metadata", async () => {
  const manifest = await loadAgentManifests("/tmp/agents");

  expect(manifest.screenwriter).toEqual({
    name: "screenwriter",
    description: "Writes scripts",
    skills: ["script-adapt", "script-writer"],
    mcpServers: ["storage", "script"],
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/agent-manifest.test.ts
```

Expected: FAIL because `loadAgentManifests()` does not exist.

**Step 3: Write minimal implementation**

Create `src/agent-manifest.ts` and move routing metadata into a single loader:

```ts
export interface AgentManifest {
  name: string;
  description: string;
  skills: string[];
  mcpServers: string[];
}

export async function loadAgentManifests(agentsDir: string): Promise<Record<string, AgentManifest>> {
  const yamlConfigs = await loadAgentConfigs(agentsDir);
  const manifests: Record<string, AgentManifest> = {};

  for (const [name, config] of Object.entries(yamlConfigs)) {
    const skillsDir = path.join(agentsDir, name, ".claude", "skills");
    const skills = await listMarkdownSkillNames(skillsDir);
    manifests[name] = {
      name,
      description: config.description,
      skills,
      mcpServers: config.mcpServers ?? inferMcpServersFromName(name),
    };
  }

  return manifests;
}
```

Also extend `src/loader.ts` config type:

```ts
export interface AgentConfig {
  name: string;
  description: string;
  skills?: string[];
  mcpServers?: string[];
}
```

**Step 4: Run tests to verify it passes**

Run:

```bash
bun test tests/agent-manifest.test.ts tests/loader.test.ts tests/loader-extended.test.ts
```

Expected: PASS. `buildOptions()` should now read manifests instead of bare YAML skill arrays.

**Step 5: Commit**

```bash
git add src/agent-manifest.ts src/loader.ts src/options.ts tests/agent-manifest.test.ts tests/loader.test.ts tests/loader-extended.test.ts
git commit -m "feat: add agent manifest loader"
```

### Task 3: Split Main And Worker Session Specs

**Files:**
- Create: `src/session-specs.ts`
- Create: `tests/session-specs.test.ts`
- Modify: `src/options.ts`
- Modify: `src/agent-options.ts`
- Modify: `src/sandbox-orchestrator.ts`

**Step 1: Write the failing test**

Create a new pure-spec test so the orchestration policy is no longer implicit:

```ts
it("builds a dispatch-only main session spec", async () => {
  const spec = await buildMainSessionSpec({
    projectPath: "/workspace",
    agentsDir: "agents",
  });

  expect(spec.permissionMode).toBe("default");
  expect(spec.allowedTools).toEqual(["TodoWrite"]);
  expect(spec.disallowedTools).toEqual(expect.arrayContaining(["Bash", "Write", "Edit"]));
  expect(spec.mcpServerNames).toEqual(["switch"]);
});

it("builds a worker session spec without inheriting main restrictions", async () => {
  const spec = await buildWorkerSessionSpec({
    projectPath: "/workspace",
    agentsDir: "agents",
    agentName: "screenwriter",
    manifest: {
      name: "screenwriter",
      description: "Writes scripts",
      skills: ["script-writer"],
      mcpServers: ["storage", "script"],
    },
  });

  expect(spec.settingSources).toEqual(["project"]);
  expect(spec.cwd).toBe(path.resolve("agents", "screenwriter"));
  expect(spec.mcpServerNames).toEqual(["storage", "script", "switch"]);
  expect(spec.permissionMode).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/session-specs.test.ts
```

Expected: FAIL because `buildMainSessionSpec()` and `buildWorkerSessionSpec()` do not exist.

**Step 3: Write minimal implementation**

Create `src/session-specs.ts` and make `options.ts` / `agent-options.ts` thin adapters:

```ts
export interface SessionSpec {
  cwd: string;
  settingSources: SettingSource[];
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: PermissionMode;
  hooks?: ClaudeAgentOptions["hooks"];
  mcpServerNames: string[];
  systemPrompt: ClaudeAgentOptions["systemPrompt"];
}

export async function buildMainSessionSpec(input: BuildMainSessionSpecInput): Promise<SessionSpec> {
  return {
    cwd: input.projectPath,
    settingSources: ["project"],
    allowedTools: ["TodoWrite"],
    disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit"],
    permissionMode: "default",
    mcpServerNames: ["switch"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: buildDispatcherPrompt(input),
    },
  };
}
```

Refactor `buildAgentOptions()` so it only carries shared neutral fields:

```ts
const {
  systemPrompt: _systemPrompt,
  mcpServers: _mcpServers,
  hooks: _hooks,
  allowedTools: _allowedTools,
  disallowedTools: _disallowedTools,
  permissionMode: _permissionMode,
  agents: _agents,
  agent: _agent,
  ...shared
} = baseOptions;
```

**Step 4: Run tests to verify it passes**

Run:

```bash
bun test tests/session-specs.test.ts tests/options.test.ts tests/agent-options.test.ts
```

Expected: PASS. Main and worker session policy should now be explicit and independently testable.

**Step 5: Commit**

```bash
git add src/session-specs.ts src/options.ts src/agent-options.ts src/sandbox-orchestrator.ts tests/session-specs.test.ts tests/options.test.ts tests/agent-options.test.ts
git commit -m "refactor: split main and worker session specs"
```

### Task 4: Make MCP Exposure Least-Privilege And Factory-Only

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `src/sandbox-orchestrator.ts`
- Create: `tests/tools-index.test.ts`
- Modify: `tests/sandbox-orchestrator.test.ts`

**Step 1: Write the failing test**

Add tests that require per-session MCP scoping:

```ts
it("creates fresh MCP servers for main session with switch only", () => {
  const servers = createToolServers(["switch"]);
  expect(Object.keys(servers)).toEqual(["switch"]);
});

it("creates fresh MCP servers for worker session from manifest", () => {
  const servers = createToolServers(["storage", "script", "switch"]);
  expect(Object.keys(servers)).toEqual(["storage", "script", "switch"]);
});
```

And in orchestrator:

```ts
it("injects only manifest-approved MCP servers into worker queries", async () => {
  // Assert screenwriter does not receive image/video/audio MCP servers.
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/tools-index.test.ts tests/sandbox-orchestrator.test.ts
```

Expected: FAIL because `createToolServers()` does not accept a scoped server list.

**Step 3: Write minimal implementation**

Refactor `src/tools/index.ts`:

```ts
const SERVER_BUILDERS = {
  storage: () => createSdkMcpServer({ name: "storage", tools: [writeJson, readJson, saveAsset, listAssets] }),
  image: () => createSdkMcpServer({ name: "image", tools: [generateImage, upscaleImage] }),
  video: () => createSdkMcpServer({ name: "video", tools: [generateVideo, checkVideoStatus] }),
  audio: () => createSdkMcpServer({ name: "audio", tools: [generateTts, generateSfx, generateMusic] }),
  script: () => createSdkMcpServer({ name: "script", tools: [parseScript] }),
};

export function createToolServers(names: Array<keyof typeof SERVER_BUILDERS | "switch"> = []) {
  const servers: Record<string, unknown> = {};

  for (const name of names) {
    if (name === "switch") continue;
    servers[name] = SERVER_BUILDERS[name]();
  }

  return servers;
}
```

Update orchestrator query setup:

```ts
const serverNames = session.name === "main"
  ? ["switch"]
  : [...session.manifest.mcpServers, "switch"];

session.options.mcpServers = {
  ...createToolServers(serverNames.filter((name) => name !== "switch")),
  switch: isMain ? masterServer : agentServer,
};
```

**Step 4: Run tests to verify it passes**

Run:

```bash
bun test tests/tools-index.test.ts tests/sandbox-orchestrator.test.ts
```

Expected: PASS. Main should no longer see domain MCP servers, and worker agents should only get the MCP surface their manifest allows.

**Step 5: Commit**

```bash
git add src/tools/index.ts src/sandbox-orchestrator.ts tests/tools-index.test.ts tests/sandbox-orchestrator.test.ts
git commit -m "refactor: scope mcp servers per session"
```

### Task 5: Rebuild Hooks Around SDK-Native Session Metadata

**Files:**
- Modify: `src/hooks/index.ts`
- Modify: `src/hooks/tool-logger.ts`
- Delete: `src/hooks/cost-guard.ts`
- Modify: `tests/hooks/tool-logger.test.ts`
- Create: `tests/hooks/index.test.ts`
- Modify: `tests/options.test.ts`

**Step 1: Write the failing test**

Add tests that require hook output to use native hook fields:

```ts
it("emits tool_log with agent metadata from hook input", async () => {
  const logger = createToolLogger();

  await logger.preToolUse({
    hook_event_name: "PreToolUse",
    session_id: "sess-1",
    cwd: "/workspace/agents/screenwriter",
    agent_type: "screenwriter",
    tool_name: "Read",
    tool_input: { file_path: "/workspace/draft/a.md" },
    tool_use_id: "tool-1",
    transcript_path: "/tmp/transcript.jsonl",
  });

  expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
    type: "tool_log",
    agent: "screenwriter",
    detail: expect.objectContaining({ session_id: "sess-1" }),
  }));
});

it("does not register the custom cost guard hook", () => {
  const hooks = buildHooks();
  expect(hooks.PreToolUse).toHaveLength(2);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/hooks/tool-logger.test.ts tests/hooks/index.test.ts tests/options.test.ts
```

Expected: FAIL because `createToolLogger()` still needs a closure-provided agent name and `buildHooks()` still installs the custom budget guard.

**Step 3: Write minimal implementation**

Use SDK-native hook input instead of outer state:

```ts
export function createToolLogger(): ToolLogger {
  return {
    preToolUse: async (input) => {
      const agent = input.agent_type;
      emit({
        type: "tool_log",
        tool: input.tool_name,
        phase: "pre",
        agent,
        detail: {
          session_id: input.session_id,
          cwd: input.cwd,
        },
      });
      return {};
    },
```

Simplify hook registry:

```ts
export function buildHooks() {
  const logger = createToolLogger();
  return {
    PreToolUse: [{ hooks: [schemaValidator, logger.preToolUse] }],
    PostToolUse: [{ hooks: [logger.postToolUse] }],
  };
}
```

**Step 4: Run tests to verify it passes**

Run:

```bash
bun test tests/hooks/tool-logger.test.ts tests/hooks/index.test.ts tests/options.test.ts
```

Expected: PASS. Hook logs should identify agents from SDK metadata, and budget control should rely on SDK-native `maxBudgetUsd`.

**Step 5: Commit**

```bash
git add src/hooks/index.ts src/hooks/tool-logger.ts tests/hooks/tool-logger.test.ts tests/hooks/index.test.ts tests/options.test.ts
git rm src/hooks/cost-guard.ts
git commit -m "refactor: use sdk-native hook metadata"
```

### Task 6: Close The Session Restore Gap For Lazy Agents

**Files:**
- Modify: `src/sandbox-orchestrator.ts`
- Modify: `src/session-history.ts`
- Modify: `tests/sandbox-orchestrator.test.ts`
- Modify: `tests/web/reduce-sandbox-event.test.ts`

**Step 1: Write the failing test**

Add a regression test for restored worker history:

```ts
it("emits worker history after a resumed lazy agent is first created", async () => {
  mockGetSessionMessages.mockResolvedValue([
    { type: "user", message: "Write episode 1", parent_tool_use_id: null },
    { type: "assistant", message: { content: "Draft ready" }, parent_tool_use_id: null },
  ]);

  const orch = new SandboxOrchestrator({
    projectPath: "/tmp/test",
    agentsDir: "agents",
  });

  await orch.init();
  mockEmit.mockClear();

  await orch.enterAgent("script-writer");

  expect(emitted("history")).toEqual([
    expect.objectContaining({
      agent: "script-writer",
      messages: [
        { role: "user", content: "Write episode 1" },
        { role: "assistant", content: "Draft ready" },
      ],
    }),
  ]);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/sandbox-orchestrator.test.ts tests/web/reduce-sandbox-event.test.ts
```

Expected: FAIL because the resumed worker session does not emit history when lazily created.

**Step 3: Write minimal implementation**

Emit history when a resumed worker is materialized:

```ts
private async hydrateAgentHistory(session: AgentSession): Promise<void> {
  if (!session.sessionId || session.historyLoaded) return;

  const dir = path.resolve(this.config.agentsDir, session.name);
  const messages = await fetchHistory(session.sessionId, dir, HISTORY_LIMIT_SANDBOX);
  if (messages.length > 0) {
    emit({ type: "history", agent: session.name, messages });
  }
  session.historyLoaded = true;
}
```

Call it from `getOrCreateAgent()` immediately after applying the persisted session ID.

**Step 4: Run tests to verify it passes**

Run:

```bash
bun test tests/sandbox-orchestrator.test.ts tests/web/reduce-sandbox-event.test.ts
```

Expected: PASS. UI state should rebuild worker history deterministically when a resumed agent is entered for the first time.

**Step 5: Commit**

```bash
git add src/sandbox-orchestrator.ts src/session-history.ts tests/sandbox-orchestrator.test.ts tests/web/reduce-sandbox-event.test.ts
git commit -m "fix: restore history for resumed lazy agents"
```

### Task 7: Verify End-To-End And Update Architecture Docs

**Files:**
- Modify: `docs/architecture-dispatch.md`
- Modify: `docs/other-claude-readme.md`
- Modify: `tests/smoke.test.ts`

**Step 1: Write the failing test**

Add or update a smoke test that asserts the new invariants:

```ts
it("reports dispatch-only main agent and worker-specific skills", async () => {
  // Assert ready/skills payload is unchanged for the UI,
  // but main session does not expose domain MCP servers.
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/smoke.test.ts
```

Expected: FAIL because the docs and smoke expectation still describe the old permission and MCP model.

**Step 3: Write minimal implementation**

Update docs to state the final rules clearly:

- why custom routing remains
- why main is dispatch-only
- why agent permissions come from filesystem settings, while session policy is defined programmatically only where SDK-native behavior requires it
- how manifests define routing tags plus MCP surface

Doc excerpt:

```md
Main session:
- uses SDK-native `maxBudgetUsd`
- exposes only the `switch` MCP server
- uses minimal built-in tools for planning and routing

Worker sessions:
- load `agents/<name>/.claude/CLAUDE.md` and `.claude/settings.json`
- receive only manifest-approved MCP servers plus `return_to_main`
- do not inherit main-session `allowedTools` or permission overrides
```

**Step 4: Run tests to verify it passes**

Run:

```bash
bun test
bun run build
bun run lint
```

Expected: PASS. Build, tests, and lint should all complete without restoring the old duplicated permission/budget model.

**Step 5: Commit**

```bash
git add docs/architecture-dispatch.md docs/other-claude-readme.md tests/smoke.test.ts
git commit -m "docs: describe sdk-native orchestration model"
```

## Implementation Notes

- Prefer deleting duplicated orchestration policy over layering a third abstraction on top of it.
- Keep `SandboxOrchestrator` focused on session lifecycle, queues, and protocol events.
- Keep SDK semantics visible in code:
  session spec builders should say exactly which policy is programmatic and which policy comes from filesystem settings.
- Do not reintroduce custom budget accounting unless there is a concrete cross-session budgeting requirement that the SDK cannot represent.
- If an agent truly needs a built-in tool denied regardless of `permissionMode`, use `disallowedTools` explicitly; do not rely on `allowedTools` as a whitelist because the SDK does not treat it that way.

## Recommended Verification Order

1. `bun test tests/options.test.ts tests/agent-options.test.ts tests/session-specs.test.ts`
2. `bun test tests/tools-index.test.ts tests/sandbox-orchestrator.test.ts`
3. `bun test tests/hooks/tool-logger.test.ts tests/hooks/index.test.ts`
4. `bun test tests/web/reduce-sandbox-event.test.ts tests/smoke.test.ts`
5. `bun test`
6. `bun run build`
7. `bun run lint`

## Suggested Commit Order

1. `test: lock sdk-native orchestration semantics`
2. `feat: add agent manifest loader`
3. `refactor: split main and worker session specs`
4. `refactor: scope mcp servers per session`
5. `refactor: use sdk-native hook metadata`
6. `fix: restore history for resumed lazy agents`
7. `docs: describe sdk-native orchestration model`
