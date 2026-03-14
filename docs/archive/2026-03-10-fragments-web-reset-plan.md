# Fragments Web Reset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current `web/` frontend with a clean upstream `e2b-dev/fragments` baseline, then reconnect the minimum AgentOS runtime surface on top of that baseline.

**Architecture:** Perform the reset in an isolated git worktree so the current dirty workspace remains intact. Treat the upstream frontend as the new source of truth for app shell, styling, and component structure, while reintroducing AgentOS-specific transport and file preview integration in thin layers after the reset.

**Tech Stack:** Bun, Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, Vitest, git worktrees

### Task 1: Prepare isolated workspace and rollback safety

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.gitignore`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/docs/plans/2026-03-10-fragments-web-reset-plan.md`

**Step 1: Ignore the worktree directory**

```gitignore
.worktrees/
```

**Step 2: Commit only the ignore rule**

Run: `git add .gitignore`
Expected: `.gitignore` is staged and no unrelated files are staged.

Run: `git commit -m "chore: ignore .worktrees"`
Expected: a single commit is created so future worktree creation is safe.

**Step 3: Create an isolated worktree**

Run: `git worktree add .worktrees/fragments-reset -b fragments-reset`
Expected: a new worktree exists at `.worktrees/fragments-reset` on branch `fragments-reset`.

**Step 4: Verify the baseline before frontend replacement**

Run: `bun test`
Expected: either PASS, or a clear report of pre-existing failures before frontend reset starts.

### Task 2: Capture upstream fragments as the new frontend baseline

**Files:**
- Delete: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/web/**`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/web/**`

**Step 1: Add a temporary upstream checkout**

Run: `git clone https://github.com/e2b-dev/fragments /tmp/fragments-upstream`
Expected: upstream source is available locally for comparison and copy.

**Step 2: Replace the current `web/` directory contents**

Run: remove the current `web/` contents inside the isolated worktree, then copy the upstream frontend files into `web/`.
Expected: `web/` matches the upstream baseline with no leftover local UI files.

**Step 3: Install frontend dependencies with Bun**

Run: `cd web && bun install`
Expected: lockfile and dependencies align with the upstream frontend baseline.

**Step 4: Verify the pure upstream frontend builds**

Run: `cd web && bun run build`
Expected: the upstream frontend builds before any AgentOS-specific integration is reapplied.

### Task 3: Reintroduce the minimum AgentOS runtime bridge

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/web/app/**`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/web/components/**`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/web/lib/**`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/tests/web/**`

**Step 1: Write a failing test for AgentOS server URL and project bootstrap**

```typescript
import { describe, expect, it } from "vitest";
import { getServerBaseUrl } from "../../web/hooks/use-sandbox-connection";

describe("AgentOS frontend bridge", () => {
  it("uses the configured AgentOS server base URL", () => {
    expect(getServerBaseUrl()).toBe("http://localhost:3001");
  });
});
```

**Step 2: Run the targeted test to confirm RED**

Run: `bun x vitest run tests/web/agentos-bridge.test.ts`
Expected: FAIL because the upstream baseline does not expose the AgentOS bridge yet.

**Step 3: Implement the thinnest runtime bridge**

- Reintroduce AgentOS-specific environment handling.
- Reconnect WebSocket transport and the minimal runtime provider.
- Keep upstream UI structure intact unless a concrete incompatibility blocks runtime integration.

**Step 4: Re-run the targeted test**

Run: `bun x vitest run tests/web/agentos-bridge.test.ts`
Expected: PASS.

**Step 5: Verify the integrated frontend builds**

Run: `cd web && bun run build`
Expected: PASS with the upstream-based UI and minimal AgentOS integration.

### Task 4: Restore essential workspace surfaces incrementally

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/web/components/**`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/web/hooks/**`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/web/lib/**`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/.worktrees/fragments-reset/tests/web/**`

**Step 1: Add a failing test for file selection and preview routing**

```typescript
import { describe, expect, it } from "vitest";
import { getPreviewKind } from "../../web/lib/preview";

describe("preview routing", () => {
  it("treats markdown files as previewable content", () => {
    expect(getPreviewKind("/workspace/output/readme.md")).toBe("markdown");
  });
});
```

**Step 2: Run the targeted test to confirm RED**

Run: `bun x vitest run tests/web/preview-routing.test.ts`
Expected: FAIL until the AgentOS preview helpers are restored or adapted.

**Step 3: Reintroduce only the required workspace features**

- File browser backed by AgentOS file APIs.
- Preview routing for markdown, JSON, image, and video outputs.
- Minimal agent/session selection UI if upstream fragments does not provide an equivalent.

**Step 4: Run focused web tests**

Run: `bun x vitest run tests/web/*.test.ts`
Expected: PASS for the restored AgentOS-specific browser surfaces.

**Step 5: Run final verification**

Run: `bun test`
Expected: no new regressions caused by the frontend reset branch.
