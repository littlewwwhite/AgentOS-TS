# Filesystem-Driven Agent Architecture Refactor

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate from code-assembled agent configs (YAML + loader + buildAgents prompt injection) to filesystem-driven agent configs (`.claude/` directories with SDK-native loading), following the e2b-claude-agent pattern.

**Architecture:** Each agent gets its own directory containing `.claude/CLAUDE.md` (role prompt), `.claude/settings.json` (tool permissions), and `.claude/skills/*.md` (domain knowledge). The SDK loads these natively via `settingSources: ["project"]` + per-agent `cwd`. The manual `buildAgents()` prompt concatenation, `loadSkillContents()`, and `AgentConfig` YAML parsing are eliminated.

**Tech Stack:** TypeScript, @anthropic-ai/claude-agent-sdk, vitest, bun

---

## Phase 1: Create Agent Directory Structure

### Task 1: Create screenwriter agent `.claude/` directory

**Files:**
- Create: `agents/screenwriter/.claude/CLAUDE.md`
- Create: `agents/screenwriter/.claude/settings.json`

**Step 1: Create CLAUDE.md from current YAML description + skill contents**

The current agent identity is split across `agents/screenwriter.yaml` (description) and `skills/script-writer/SKILL.md` + `skills/script-adapt/SKILL.md` (knowledge). Merge into a single CLAUDE.md.

Read the existing skill files to understand what content to include:

```bash
cat skills/script-writer/SKILL.md
cat skills/script-adapt/SKILL.md
```

Create `agents/screenwriter/.claude/CLAUDE.md` with this structure:

```markdown
# Role: screenwriter

编剧：负责剧本创作，支持原创和小说改编两种模式，通过多阶段流程产出可指导 AI 生成画面的结构化剧本。

You are a specialized agent in a video production pipeline.
Stay in character — only perform tasks within your domain.
Respond in Chinese (简体中文), use English for structural keys and code.

## Domain Skills
- **script-writer**: [description from frontmatter]
- **script-adapt**: [description from frontmatter]

[Paste full content of skills/script-writer/SKILL.md body here]

[Paste full content of skills/script-adapt/SKILL.md body here]
```

Note: The actual content must be copied from the existing SKILL.md files. Do NOT write placeholder text.

**Step 2: Create settings.json with permissions**

Derive from `agents/screenwriter.yaml` `allowed-tools` and `file-policy`:

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Write(draft/**)",
      "Write(output/**)",
      "mcp__storage__write_json",
      "mcp__storage__read_json",
      "mcp__storage__list_assets",
      "mcp__script__parse_script"
    ],
    "deny": [
      "Bash(*)",
      "Write(../*)","Write(assets/**)",
      "Agent(*)",
      "Skill(*)"
    ]
  }
}
```

**Step 3: Verify structure**

```bash
ls -la agents/screenwriter/.claude/
# Expected: CLAUDE.md  settings.json
```

**Step 4: Commit**

```bash
git add agents/screenwriter/.claude/
git commit -m "feat(agents): create screenwriter .claude/ directory with CLAUDE.md + settings.json"
```

---

### Task 2: Create remaining agent `.claude/` directories

Repeat Task 1 for each agent. Files:

- Create: `agents/art-director/.claude/CLAUDE.md`
- Create: `agents/art-director/.claude/settings.json`
- Create: `agents/video-producer/.claude/CLAUDE.md`
- Create: `agents/video-producer/.claude/settings.json`
- Create: `agents/post-production/.claude/CLAUDE.md`
- Create: `agents/post-production/.claude/settings.json`
- Create: `agents/skill-creator/.claude/CLAUDE.md`
- Create: `agents/skill-creator/.claude/settings.json`

**Step 1: For each agent, create CLAUDE.md**

Same structure as Task 1: merge YAML description + skill SKILL.md contents. Each CLAUDE.md must contain ALL the skill knowledge that was previously injected by `buildAgents()`.

**Step 2: For each agent, create settings.json**

Map `allowed-tools` → `permissions.allow`, `file-policy` → path-specific allow/deny.

Key permission rules per agent:

**art-director:**
```json
{
  "permissions": {
    "allow": [
      "Read", "Bash(ls *)", "Bash(python3 *)",
      "Write(assets/**)", "Write(draft/**)",
      "mcp__image__generate_image", "mcp__image__upscale_image",
      "mcp__storage__read_json", "mcp__storage__write_json",
      "mcp__storage__save_asset", "mcp__storage__list_assets"
    ],
    "deny": [
      "Write(../*)", "Write(production/**)", "Write(output/script.json)",
      "Agent(*)", "Skill(*)"
    ]
  }
}
```

**video-producer:**
```json
{
  "permissions": {
    "allow": [
      "Read", "Bash(ls *)", "Bash(ffprobe *)",
      "Write(production/**)",
      "mcp__video__generate_video", "mcp__video__check_video_status",
      "mcp__storage__read_json", "mcp__storage__list_assets"
    ],
    "deny": [
      "Write(../*)", "Write(draft/**)", "Write(assets/**)",
      "Agent(*)", "Skill(*)"
    ]
  }
}
```

**post-production:**
```json
{
  "permissions": {
    "allow": [
      "Read", "Bash(ls *)", "Bash(ffmpeg *)",
      "Write(audio/**)", "Write(editing/**)",
      "mcp__audio__generate_music", "mcp__audio__generate_sfx",
      "mcp__storage__read_json", "mcp__storage__write_json",
      "mcp__storage__list_assets"
    ],
    "deny": [
      "Write(../*)", "Write(draft/**)", "Write(assets/**)",
      "Agent(*)", "Skill(*)"
    ]
  }
}
```

**skill-creator:**
```json
{
  "permissions": {
    "allow": [
      "Read", "Write", "Glob", "Grep"
    ],
    "deny": [
      "Bash(*)", "Agent(*)", "Skill(*)"
    ]
  }
}
```

**Step 3: Verify all structures**

```bash
find agents/ -name "CLAUDE.md" -o -name "settings.json" | sort
# Expected:
# agents/art-director/.claude/CLAUDE.md
# agents/art-director/.claude/settings.json
# agents/post-production/.claude/CLAUDE.md
# agents/post-production/.claude/settings.json
# agents/screenwriter/.claude/CLAUDE.md
# agents/screenwriter/.claude/settings.json
# agents/skill-creator/.claude/CLAUDE.md
# agents/skill-creator/.claude/settings.json
# agents/video-producer/.claude/CLAUDE.md
# agents/video-producer/.claude/settings.json
```

**Step 4: Commit**

```bash
git add agents/
git commit -m "feat(agents): create .claude/ directories for all agents"
```

---

### Task 3: Copy skills into agent `.claude/skills/` directories

Instead of a shared `skills/` directory, each agent gets only its relevant skills.

**Files:**
- Create: `agents/screenwriter/.claude/skills/script-writer.md` (copy from `skills/script-writer/SKILL.md`)
- Create: `agents/screenwriter/.claude/skills/script-adapt.md` (copy from `skills/script-adapt/SKILL.md`)
- Create: `agents/art-director/.claude/skills/asset-gen.md` (copy from `skills/asset-gen/SKILL.md`)
- Create: `agents/art-director/.claude/skills/image-create.md` (etc.)
- Create: `agents/art-director/.claude/skills/image-edit.md`
- Create: `agents/art-director/.claude/skills/kling-video-prompt.md`
- Create: `agents/video-producer/.claude/skills/video-create.md`
- Create: `agents/video-producer/.claude/skills/video-review.md`
- Create: `agents/post-production/.claude/skills/music-matcher.md`
- Create: `agents/skill-creator/.claude/skills/skill-creator.md`

**Step 1: Copy each skill file**

For each agent, copy its referenced skills from `skills/<name>/SKILL.md` to `agents/<agent>/.claude/skills/<name>.md`.

```bash
# Example for screenwriter:
mkdir -p agents/screenwriter/.claude/skills
cp skills/script-writer/SKILL.md agents/screenwriter/.claude/skills/script-writer.md
cp skills/script-adapt/SKILL.md agents/screenwriter/.claude/skills/script-adapt.md
```

Repeat for all agents based on their YAML `skills:` field mapping.

**Step 2: Also copy skill `references/` directories if they exist**

Some skills have `references/`, `templates/`, `scripts/` subdirectories. These should be accessible from the agent directory. Use symlinks or copy:

```bash
# If skills/script-writer/references/ exists:
cp -r skills/script-writer/references agents/screenwriter/.claude/skills/script-writer-references
```

**Step 3: Verify**

```bash
find agents/ -path "*/.claude/skills/*.md" | sort
```

**Step 4: Commit**

```bash
git add agents/
git commit -m "feat(agents): distribute skills to per-agent .claude/skills/ directories"
```

---

## Phase 2: Refactor SDK Integration

### Task 4: Rewrite `buildAgentOptions()` for filesystem-driven loading

**Files:**
- Modify: `src/sandbox-orchestrator.ts:208-211`

**Step 1: Write the failing test**

Create or modify `tests/sandbox-orchestrator.test.ts` to verify the new options shape:

```typescript
import { describe, it, expect } from "vitest";

describe("buildAgentOptions", () => {
  it("should set cwd to agent directory and settingSources to project", () => {
    // We need to test that buildAgentOptions returns:
    // - cwd: path.resolve(agentsDir, name)
    // - settingSources: ["project"]
    // - no systemPrompt (stripped)
    // - agents: undefined
    // - agent: name
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/sandbox-orchestrator.test.ts -t "buildAgentOptions"
```

**Step 3: Modify `sandbox-orchestrator.ts`**

Current `buildAgentOptions` (line 208-211):
```typescript
private buildAgentOptions(name: string): Record<string, unknown> {
  const { systemPrompt: _orchestratorPrompt, ...rest } = this.baseOptions;
  return { ...rest, agent: name, agents: undefined, settingSources: [] };
}
```

New version:
```typescript
private buildAgentOptions(name: string): Record<string, unknown> {
  const { systemPrompt: _orchestratorPrompt, ...rest } = this.baseOptions;
  const agentDir = path.resolve(this.config.agentsDir, name);
  const workspacePath = this.config.projectPath;
  return {
    ...rest,
    agent: name,
    agents: undefined,
    cwd: agentDir,
    settingSources: ["project"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `Project workspace: ${workspacePath}/\nAll file operations must use absolute paths within this workspace.`,
    },
  };
}
```

Add `import path from "node:path";` at the top if not present.

**Step 4: Run test to verify it passes**

```bash
bun test tests/sandbox-orchestrator.test.ts -t "buildAgentOptions"
```

**Step 5: Commit**

```bash
git add src/sandbox-orchestrator.ts tests/sandbox-orchestrator.test.ts
git commit -m "refactor(sandbox): use filesystem-driven agent options with per-agent cwd"
```

---

### Task 5: Rewrite `buildOptions()` to stop loading skills into agents

**Files:**
- Modify: `src/options.ts:53-112`

**Step 1: Write the failing test**

In `tests/options.test.ts`, verify that `buildOptions()` still returns valid agents but no longer has prompt-injected skill content:

```typescript
it("should load agent descriptions for orchestrator routing without skill prompt injection", async () => {
  const opts = await buildOptions(tmpDir, agentsDir, skillsDir);
  // agents map should exist for orchestrator routing
  expect(opts.agents).toBeDefined();
  // But the agent descriptions are now just for routing, not full prompts
  for (const [name, defn] of Object.entries(opts.agents)) {
    expect(defn.description).toBeTruthy();
  }
});
```

**Step 2: Simplify `buildOptions()`**

The orchestrator still needs to know WHAT agents exist (for Agent tool dispatch). But it no longer needs to build their full prompts.

Replace the current flow:
```
loadAgentConfigs → loadSkillContents → buildAgents → full prompt assembly
```

With:
```
loadAgentConfigs → lightweight agent map (name + description only)
```

New `buildOptions()`:

```typescript
export async function buildOptions(
  projectPath: string,
  agentsDir: string,
  skillsDir: string,  // kept for backward compat but no longer used for prompt injection
  model?: string,
  resume?: string,
  continueConversation = false,
) {
  const agentConfigs = await loadAgentConfigs(agentsDir);

  // Build lightweight agent definitions for orchestrator routing only.
  // Full agent config (prompt, skills, permissions) lives in agents/<name>/.claude/
  // and is loaded natively by SDK when cwd points to the agent directory.
  const agents: Record<string, { description: string; configuredSkills?: string[] }> = {};
  for (const [name, config] of Object.entries(agentConfigs)) {
    agents[name] = {
      description: config.description,
      configuredSkills: config.skills,
    };
  }

  return {
    agents,
    mcpServers: toolServers,
    allowedTools: [
      "Agent", "TodoWrite",
      "Read", "Write", "Bash", "Glob", "Grep",
    ],
    hooks: buildSandboxHooks(),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        "You are a video production orchestrator.\n" +
        "Your ONLY job is to understand user intent and dispatch to the right sub-agent.\n" +
        "Do NOT perform domain work (writing scripts, generating images, etc.) yourself.\n\n" +
        `Project workspace: ${projectPath}/\n` +
        `Source materials: ${path.resolve(projectPath, "../data")}/\n` +
        `${await describeWorkspace(projectPath)}\n\n` +
        `${describeAgentList(agents)}\n\n` +
        "## Dispatch Rules (STRICT)\n" +
        "- Dispatch domain tasks to the appropriate sub-agent via the Agent tool\n" +
        "- **CRITICAL**: When using the Agent tool, you MUST include the user's COMPLETE message in the `prompt` parameter. " +
        "The `description` is only a short label — the actual task content goes in `prompt`.\n" +
        "- If user mentions a skill name, map it to the owning agent via [skills: ...] tags above\n" +
        "- If user wants to talk directly to a sub-agent (e.g. '进入编剧', 'switch to screenwriter'), " +
        "dispatch via Agent tool with the user's message as prompt\n" +
        "- NEVER read files under skills/ directory or run Python scripts directly\n" +
        "- NEVER perform domain work yourself — always delegate to the owning sub-agent\n" +
        "- All content in Chinese (简体中文), structural keys in English\n" +
        "- Use TodoWrite to show progress on multi-step tasks\n" +
        "- When user references a source file (e.g. '测0.txt'), copy it from source materials to workspace as source.txt, then dispatch\n\n" +
        "## Planning Requirement\n" +
        "Before dispatching any multi-step task:\n" +
        "1. Use TodoWrite to outline the plan\n" +
        "2. Dispatch to the sub-agent\n" +
        "3. Update TodoWrite as steps complete",
    },
    betas: ["context-1m-2025-08-07"],
    settingSources: ["project"],
    cwd: projectPath,
    permissionMode: "acceptEdits",
    includePartialMessages: true,
    maxBudgetUsd: 10.0,
    model,
    resume,
    continueConversation,
  };
}
```

**Step 3: Remove `buildAgents` import**

In `src/options.ts`, remove:
```typescript
import { buildAgents } from "./agents.js";
import { loadSkillContents } from "./loader.js";
```

Only keep:
```typescript
import { loadAgentConfigs } from "./loader.js";
```

**Step 4: Run all tests**

```bash
bun test
```

Fix any test failures that depend on the old `buildAgents()` return shape.

**Step 5: Commit**

```bash
git add src/options.ts tests/options.test.ts
git commit -m "refactor(options): simplify to lightweight agent routing map, remove skill prompt injection"
```

---

### Task 6: Update local orchestrator for filesystem-driven agents

**Files:**
- Modify: `src/orchestrator.ts:556-571`

**Step 1: Update the direct-mode agent options**

Current code (line 559-568) sets `settingSources: []` which prevents SDK from loading `.claude/`:

```typescript
if (activeAgent) {
  const { systemPrompt: _orchestratorPrompt, ...agentOptions } = options;
  effectiveOptions = {
    ...agentOptions,
    agent: activeAgent,
    resume: agentSessions.get(activeAgent),
    continueConversation: false,
    settingSources: [], // prevent global CLAUDE.md from overriding agent role
  };
}
```

Change to:
```typescript
if (activeAgent) {
  const { systemPrompt: _orchestratorPrompt, ...agentOptions } = options;
  const agentDir = path.resolve(agentsDir, activeAgent);
  effectiveOptions = {
    ...agentOptions,
    agent: activeAgent,
    resume: agentSessions.get(activeAgent),
    continueConversation: false,
    cwd: agentDir,
    settingSources: ["project"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `Project workspace: ${projectPath}/\nAll file operations must use absolute paths within this workspace.`,
    },
  };
}
```

This requires `agentsDir` to be accessible in the REPL scope. Pass it through the `repl()` config or capture it in closure.

**Step 2: Run tests**

```bash
bun test
```

**Step 3: Manual smoke test**

```bash
bun start
# Then: /enter screenwriter
# Verify that the agent loads its CLAUDE.md role and skill knowledge
```

**Step 4: Commit**

```bash
git add src/orchestrator.ts
git commit -m "refactor(orchestrator): use per-agent cwd + settingSources for direct mode"
```

---

## Phase 3: Cleanup Dead Code

### Task 7: Remove `buildAgents()` and `loadSkillContents()`

**Files:**
- Delete or gut: `src/agents.ts` (entire file may be removable)
- Modify: `src/loader.ts` (remove `loadSkillContents` export)
- Modify: `src/options.ts` (already done in Task 5)

**Step 1: Check all imports of `buildAgents` and `loadSkillContents`**

```bash
rg "buildAgents|loadSkillContents" src/ tests/
```

**Step 2: Remove unused code**

If `buildAgents` is no longer imported anywhere after Task 5:
- Delete `src/agents.ts` entirely
- Remove `loadSkillContents()` from `src/loader.ts` (keep `loadAgentConfigs()` — still needed for orchestrator routing)
- Remove `SkillContent` interface from `src/loader.ts`

If `AgentDefinitionConfig` is still referenced somewhere, replace with the lightweight type.

**Step 3: Update tests**

- Delete or rewrite `tests/agents.test.ts` (no longer tests `buildAgents()`)
- Update `tests/loader.test.ts` (remove skill loading tests)
- Update `tests/options.test.ts` (no longer expects full prompt assembly)

**Step 4: Run all tests**

```bash
bun test
```

Expected: All tests pass. Some old tests will need deletion/rewrite.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove buildAgents(), loadSkillContents(), and related dead code"
```

---

### Task 8: Remove old YAML agent configs

**Files:**
- Delete: `agents/screenwriter.yaml`
- Delete: `agents/art-director.yaml`
- Delete: `agents/video-producer.yaml`
- Delete: `agents/post-production.yaml`
- Delete: `agents/skill-creator.yaml`

**Step 1: Verify YAML files are no longer referenced**

```bash
rg "\.yaml|\.yml" src/ --glob "!node_modules"
```

The only remaining reference should be in `loadAgentConfigs()` which still reads YAMLs for the orchestrator routing map. We need to decide: keep YAML for routing metadata, or derive it from `.claude/CLAUDE.md`.

**Decision: Keep a minimal YAML per agent for routing metadata only.**

Each YAML shrinks to just 2 fields:
```yaml
name: screenwriter
description: "编剧：负责剧本创作..."
skills:
  - script-adapt
  - script-writer
```

This is used ONLY by the orchestrator's `describeAgentList()` for Agent tool routing. The full agent config lives in `.claude/`.

Alternatively, extract the description from the first line of CLAUDE.md. This eliminates YAML entirely but adds complexity to `loadAgentConfigs()`.

**Recommended: Keep minimal YAMLs for now.** Strip all fields except `name`, `description`, and `skills` (for routing tags).

**Step 2: Strip YAMLs to routing-only fields**

For each YAML, remove: `model`, `max-turns`, `allowed-tools`, `disallowed-tools`, `mcp-servers`, `file-policy`.

Example `agents/screenwriter.yaml` after:
```yaml
name: screenwriter
description: "编剧：负责剧本创作，支持原创和小说改编两种模式，通过多阶段流程产出可指导 AI 生成画面的结构化剧本。"
skills:
  - script-adapt
  - script-writer
```

**Step 3: Update `AgentConfig` interface**

In `src/loader.ts`, simplify:
```typescript
export interface AgentConfig {
  name: string;
  description: string;
  skills?: string[];  // for orchestrator routing tags only
}
```

Remove `allowedTools`, `disallowedTools`, `mcpServers`, `maxTurns`, `model` fields.

**Step 4: Run tests**

```bash
bun test
```

**Step 5: Commit**

```bash
git add agents/ src/loader.ts
git commit -m "refactor(agents): strip YAMLs to routing-only metadata, full config in .claude/"
```

---

## Phase 4: Lazy Agent Sessions

### Task 9: Refactor `SandboxOrchestrator.init()` for lazy agent creation

**Files:**
- Modify: `src/sandbox-orchestrator.ts:80-100`
- Modify: `src/sandbox-orchestrator.ts:158-165` (chat method)

**Step 1: Write the failing test**

```typescript
describe("lazy agent creation", () => {
  it("should not pre-create agent sessions on init", () => {
    // After init(), agents map should be empty
    // Only mainSession should exist
  });

  it("should create agent session on first chat to that agent", () => {
    // After chat(message, "screenwriter"), the agent session should exist
  });
});
```

**Step 2: Modify `init()`**

Current (line 80-100): Creates ALL agent sessions eagerly.

New:
```typescript
async init(): Promise<void> {
  this.baseOptions = (await buildOptions(
    this.config.projectPath,
    this.config.agentsDir,
    this.config.skillsDir,
    this.config.model,
  )) as Record<string, unknown>;

  this.agentDefinitions = (this.baseOptions.agents ?? {}) as Record<
    string, { description: string }
  >;

  this.mainSession = this.createSession("main", this.baseOptions);
  // Agent sessions created lazily on first use — no pre-creation

  emit({ type: "ready", skills: Object.keys(this.agentDefinitions) });
}
```

**Step 3: Add `getOrCreateAgent()` method**

```typescript
private getOrCreateAgent(name: string): AgentSession {
  let session = this.agents.get(name);
  if (!session) {
    session = this.createSession(name, this.buildAgentOptions(name));
    this.agents.set(name, session);
    // Start worker for newly created session
    this.runWorker(session);
  }
  return session;
}
```

**Step 4: Update `chat()` to use lazy creation**

```typescript
chat(message: string, target?: string | null, requestId?: string): void {
  let session: AgentSession;
  if (target) {
    if (!this.agentDefinitions[target]) {
      emit({ type: "error", message: `Unknown agent: "${target}"`, request_id: requestId });
      return;
    }
    session = this.getOrCreateAgent(target);
  } else {
    session = this.mainSession!;
  }
  session.queue.push({ prompt: message, requestId });
}
```

**Step 5: Update `startWorkers()` — only start main worker initially**

```typescript
async startWorkers(): Promise<void> {
  if (this.mainSession) {
    await this.runWorker(this.mainSession);
  }
}
```

Note: Agent workers are now started individually by `getOrCreateAgent()`. The main worker runs indefinitely; `startWorkers()` waits on it.

**Step 6: Run tests**

```bash
bun test
```

**Step 7: Commit**

```bash
git add src/sandbox-orchestrator.ts tests/sandbox-orchestrator.test.ts
git commit -m "refactor(sandbox): lazy agent session creation on first use"
```

---

## Phase 5: Update Protocol & Documentation

### Task 10: Add `history` event to protocol

**Files:**
- Modify: `src/protocol.ts`

**Step 1: Add HistoryEvent type**

```typescript
interface HistoryEvent {
  type: "history";
  agent?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: number;
  }>;
}
```

Add to `SandboxEvent` union type.

**Step 2: Commit**

```bash
git add src/protocol.ts
git commit -m "feat(protocol): add history event type for session restoration"
```

---

### Task 11: Update architecture documentation

**Files:**
- Modify: `docs/architecture-dispatch.md`

**Step 1: Rewrite the Skills section**

Replace the current "Skills 的三重角色" section to reflect the new filesystem-driven approach:

- **Before**: Skills inject via prompt concatenation in `buildAgents()`, `AgentDefinition.skills` is metadata only
- **After**: Skills live in `agents/<name>/.claude/skills/*.md`, loaded natively by SDK via `settingSources: ["project"]`

**Step 2: Update the Agent Options section**

Document the new `buildAgentOptions()` pattern:
```
cwd: agents/<name>/          ← agent's own directory
settingSources: ["project"]  ← SDK loads .claude/CLAUDE.md + settings.json + skills/
systemPrompt.append: workspace context only
```

**Step 3: Update the file visibility table**

| Role | cwd | Config source | Permissions |
|------|-----|--------------|-------------|
| Orchestrator | workspace/ | options.ts systemPrompt | All tools |
| Sub-agent | agents/<name>/ | .claude/CLAUDE.md + settings.json | SDK-enforced allow/deny |

**Step 4: Commit**

```bash
git add docs/architecture-dispatch.md
git commit -m "docs: update architecture for filesystem-driven agent config"
```

---

## Phase 6: Final Verification

### Task 12: Full test suite + smoke test

**Step 1: Run all unit tests**

```bash
bun test
```

Expected: All tests pass.

**Step 2: Run linter**

```bash
bun run lint
```

Expected: No errors.

**Step 3: Manual smoke test — local REPL**

```bash
bun start
```

1. Send a message and verify orchestrator dispatches to agent
2. `/enter screenwriter` — verify agent loads CLAUDE.md role + skill knowledge
3. `/exit` — verify return to orchestrator
4. `/agents` — verify all agents listed

**Step 4: Manual smoke test — E2B sandbox (if available)**

```bash
bun start:e2b
```

1. Verify sandbox starts and agents are listed
2. Send a domain task and verify agent handles it with skill knowledge

**Step 5: Final commit with all remaining changes**

```bash
git add -A
git status  # verify no unintended changes
git commit -m "test: verify filesystem-driven agent architecture end-to-end"
```

---

## Summary of Changes

| Before | After |
|--------|-------|
| `agents/*.yaml` (full config: tools, model, skills, file-policy) | `agents/*.yaml` (routing only: name, description, skills tags) |
| `skills/*/SKILL.md` (shared skill pool) | `agents/<name>/.claude/skills/*.md` (per-agent skills) |
| `src/agents.ts` buildAgents() prompt concatenation | Deleted — SDK loads `.claude/CLAUDE.md` natively |
| `src/loader.ts` loadSkillContents() | Deleted — SDK loads `.claude/skills/` natively |
| `settingSources: []` (kill all SDK settings) | `settingSources: ["project"]` (SDK loads `.claude/`) |
| `file-policy` in YAML (dead code) | `settings.json` permissions (SDK-enforced) |
| Pre-create all agent sessions | Lazy creation on first use |
| No history restoration | `history` protocol event (foundation) |

**Files deleted:** `src/agents.ts` (or gutted)
**Files created:** 5x `agents/<name>/.claude/CLAUDE.md`, 5x `agents/<name>/.claude/settings.json`, ~10x `agents/<name>/.claude/skills/*.md`
**Files modified:** `src/options.ts`, `src/loader.ts`, `src/sandbox-orchestrator.ts`, `src/orchestrator.ts`, `src/protocol.ts`, `docs/architecture-dispatch.md`
