# Local Skill Loading Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align project-local skill handling with observed Claude Agent SDK behavior and remove misleading claims about native `.claude/skills` auto-loading.

**Architecture:** Keep the existing worker-side skill injection because SDK worker sessions in this repo surface global skills at init time but do not expose agent-local markdown skills from `agents/<name>/.claude/skills/`. Tighten wording in prompts and docs so the workaround is explicit, then lock that contract with regression tests.

**Tech Stack:** Bun, TypeScript, Vitest, Claude Agent SDK

### Task 1: Lock the prompt contract in tests

**Files:**
- Modify: `tests/session-specs.test.ts`
- Modify: `tests/agent-filesystem-config.test.ts`

**Step 1: Write the failing tests**

- Assert worker prompt labels the injected skill block as project-injected content instead of native auto-loaded content.
- Assert agent `CLAUDE.md` files do not claim `.claude/skills` is SDK-native auto-loaded.

**Step 2: Run tests to verify they fail**

Run:

```bash
bun run vitest run tests/session-specs.test.ts tests/agent-filesystem-config.test.ts
```

Expected: FAIL on the old `Auto-Loaded Skills` label and the old CLAUDE wording.

### Task 2: Correct runtime wording and docs

**Files:**
- Modify: `src/session-specs.ts`
- Modify: `agents/*/.claude/CLAUDE.md`
- Modify: `docs/architecture-dispatch.md`

**Step 1: Update worker prompt wording**

- Rename the injected block to `Injected Project Skills`.
- State clearly that AgentOS injects project-local skill instructions for worker sessions.

**Step 2: Update agent CLAUDE files**

- Replace “Skills are auto-loaded from `.claude/skills/`” with wording that reflects project-side injection.

**Step 3: Update architecture doc**

- Narrow SDK-native claims to `.claude/CLAUDE.md` and `settings.json`.
- Document `.claude/skills/*.md` as an AgentOS injection path, not an SDK-native discovery path.

### Task 3: Verify and preserve evidence

**Files:**
- Verify only

**Step 1: Re-run focused tests**

Run:

```bash
bun run vitest run tests/session-specs.test.ts tests/agent-filesystem-config.test.ts
```

Expected: PASS.

**Step 2: Re-run broader affected tests**

Run:

```bash
bun run vitest run tests/agent-options.test.ts tests/session-specs.test.ts tests/options.test.ts tests/tools-index.test.ts tests/agent-filesystem-config.test.ts
```

Expected: PASS.

**Step 3: Capture SDK evidence**

- Use a one-shot SDK `query()` init probe at `agents/screenwriter/` with `settingSources: ["project"]`.
- Record that the returned `skills` list contains global skills but not `script-adapt` / `script-writer`.
