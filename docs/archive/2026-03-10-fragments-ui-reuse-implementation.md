# Fragments UI Reuse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the `web/` presentation layer so it reuses Fragments UI/UX as faithfully as possible while keeping AgentOS sandbox runtime, reducer state, and file preview APIs unchanged.

**Architecture:** Treat Fragments as the presentation source of truth. Port its global tokens, core UI primitives, chat layout, chat input, preview shell, and code panel with the smallest possible diff. Keep AgentOS-specific behavior behind the existing runtime provider and only introduce minimal deltas for agent switching and the extra `Files` tab.

**Tech Stack:** Bun, TypeScript, Next.js, Tailwind CSS v4, Radix UI primitives, PrismJS, existing AgentOS WebSocket/file bridge.

### Task 1: Add a tested message adapter for the Fragments chat surface

**Files:**
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/lib/to-chat-messages.ts`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/tests/web/to-chat-messages.test.ts`

**Step 1: Write the failing test**
- Verify user/assistant timeline items are mapped in order.
- Verify tool/system/result items stay out of the chat transcript and remain available for the inspector.

**Step 2: Run the targeted test to confirm red state**
Run: `bun x vitest run tests/web/to-chat-messages.test.ts`
Expected: FAIL because the adapter module does not exist yet.

**Step 3: Implement the minimal adapter**
- Define a Fragments-style chat message shape.
- Map only transcript items needed by the left chat surface.

**Step 4: Re-run the targeted test**
Run: `bun x vitest run tests/web/to-chat-messages.test.ts`
Expected: PASS.

### Task 2: Port Fragments core primitives and theme tokens

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/package.json`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/globals.css`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/ui/button.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/ui/tabs.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/ui/tooltip.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/ui/copy-button.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/code-theme.css`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/code-view.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/fragment-code.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/logo.tsx`

**Step 1: Port Fragments theme/tokens first**
- Align CSS tokens with Fragments dark mode.
- Provide Tailwind v4-compatible theme aliases so Fragments semantic classes compile unchanged.

**Step 2: Port Fragments shadcn primitives with minimal edits**
- Copy Button, Tabs, Tooltip, CopyButton, CodeView, and FragmentCode.
- Keep only import path and syntax adjustments required by this repo.

**Step 3: Install the exact missing UI dependencies**
Run: `cd web && bun install`
Expected: lockfile and dependencies updated successfully.

### Task 3: Replace custom chat/app shell with Fragments-first layout

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/runtime-provider.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/app/layout.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/app-shell.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/chat.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/chat-input.tsx`
- Create: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/fragments/navbar.tsx`

**Step 1: Remove assistant-ui-only presentation coupling**
- Keep the runtime provider as the state/command boundary.
- Expose explicit `submitPrompt`/`interruptPrompt` helpers to feed a Fragments-style input surface.

**Step 2: Port chat and input from Fragments**
- Reuse Fragments DOM structure, spacing, and component hierarchy.
- Inject AgentTabs into the Fragments input control row as the only major delta.

**Step 3: Collapse the left shell to Fragments page layout**
- Replace the bespoke dashboard header with a Fragments-style navbar and column layout.

### Task 4: Replace bespoke inspector with a Fragments-adapted preview shell

**Files:**
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/preview-pane.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/file-browser.tsx`
- Modify: `/Users/dingzhijian/lingjing/AgentOS-TS/web/components/workbench/activity-feed.tsx`

**Step 1: Rebuild the inspector from Fragments `Preview` composition**
- Center the tab switcher exactly like Fragments.
- Keep the extra `Files` tab as the only structural addition.

**Step 2: Reuse Fragments code panel for text/code files**
- Route code/text preview through `FragmentCode`.
- Keep markdown/image/video preview as minimal fallbacks within the same shell.

**Step 3: Restyle file/activity panes to match Fragments primitives**
- Avoid bespoke cards and dashboard chrome.
- Keep only the minimal tree/list affordances not present in Fragments.

### Task 5: Verify the reuse-focused refactor end to end

**Files:**
- Verify only

**Step 1: Run targeted web tests**
Run: `bun x vitest run tests/web/to-chat-messages.test.ts tests/web/reduce-sandbox-event.test.ts`
Expected: PASS.

**Step 2: Run the web production build**
Run: `cd web && bun run build`
Expected: PASS.

**Step 3: Run the root TypeScript build**
Run: `bun run build`
Expected: PASS.
