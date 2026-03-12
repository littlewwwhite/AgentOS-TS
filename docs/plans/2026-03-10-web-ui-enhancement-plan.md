# Web UI Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve full feature parity between the web UI and the CLI sandbox mode, including layout fixes, chat message enhancement (thinking/tool display), slash command UI, and auth pipeline verification.

**Architecture:** Progressive patching of existing components — fix workbench visibility, enhance chat rendering with inline thinking/tool cards, add slash command dropdown, verify auth and E2B alignment end-to-end.

**Tech Stack:** React 19, Next.js (App Router), shadcn/ui, Tailwind CSS, WebSocket (ws), TypeScript

---

### Task 1: Fix Workbench Panel Visibility

The right-side workbench (file browser, preview, activity feed) exists in `app-shell.tsx` but doesn't render on screen. The browser shows only the chat column with `col-span-2`, meaning the grid is collapsing the inspector.

**Files:**
- Modify: `web/components/app-shell.tsx`

**Step 1: Diagnose the rendering issue**

Read `web/components/app-shell.tsx` and check the layout classes. The main container uses `flex flex-col md:flex-row`. The right panel uses `hidden` class — that's the culprit. The inspector div has `className="hidden w-3..."` on the resize handle AND may have display issues on the panel itself.

Check the browser output to confirm:
- The resize handle div at line 171 has no `md:flex` — only `hidden md:flex` should work
- The inspector panel div at line 176 should be visible on desktop

**Step 2: Fix the layout**

The resize handle already has `hidden ... md:flex` which is correct. The actual issue is likely that the inspector panel does not have proper width allocation in the flex container — it uses CSS variable `--inspector-width` but the flex parent needs the right column to not shrink to zero.

Apply this fix in `web/components/app-shell.tsx`:

Ensure the right panel container has `hidden md:flex` to show on desktop:

```tsx
// Line 176 — change:
<div
  className="min-h-[42vh] w-full border-t bg-popover shadow-2xl md:min-h-0 md:w-[var(--inspector-width)] md:border-l md:border-t-0"
// to:
<div
  className="hidden min-h-[42vh] w-full border-t bg-popover shadow-2xl md:flex md:min-h-0 md:w-[var(--inspector-width)] md:flex-col md:border-l md:border-t-0"
```

Also ensure the left column doesn't consume all space:

```tsx
// Line 126 — change:
<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
// to:
<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
```

**Step 3: Run the dev server and verify**

Run: `cd web && bun dev`
Expected: Right panel visible on desktop with Code/Preview/Files tabs + Timeline button.

**Step 4: Commit**

```bash
git add web/components/app-shell.tsx
git commit -m "fix(web): make workbench panel visible on desktop layout"
```

---

### Task 2: Add Agent Badge to Timeline Items

Currently `TimelineItem` doesn't carry the agent name. The reducer needs to propagate `event.agent` into the timeline item so the chat UI can display which agent produced each message.

**Files:**
- Modify: `web/lib/reduce-sandbox-event.ts`
- Test: `tests/web/reduce-sandbox-event.test.ts` (if exists) or `tests/reduce-sandbox-event.test.ts`

**Step 1: Write a failing test**

```typescript
// In the reducer test file
it("should preserve agent field on assistant text items", () => {
  let state = createInitialUiState();
  state = reduceSandboxEvent(state, {
    type: "ready",
    skills: ["screenwriter"],
  });
  state = reduceSandboxEvent(state, {
    type: "text",
    text: "Hello from screenwriter",
    agent: "screenwriter",
  });

  const session = state.sessions["screenwriter"];
  expect(session).toBeDefined();
  const lastMessage = session!.messages.at(-1);
  expect(lastMessage?.kind).toBe("assistant");
  expect((lastMessage as any).agent).toBe("screenwriter");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/reduce-sandbox-event.test.ts`
Expected: FAIL — `agent` property not present on assistant item.

**Step 3: Add `agent` field to relevant TimelineItem types**

In `web/lib/reduce-sandbox-event.ts`, modify the `TimelineItem` union to add `agent?` to types that support it:

```typescript
export type TimelineItem =
  | { kind: "user"; id: string; text: string; createdAt: number }
  | { kind: "assistant"; id: string; text: string; streaming: boolean; agent?: string }
  | { kind: "thinking"; id: string; text: string; streaming: boolean; agent?: string }
  | { kind: "tool_use"; id: string; tool: string; toolCallId: string; agent?: string }
  | {
      kind: "tool_log";
      id: string;
      tool: string;
      phase: "pre" | "post";
      detail?: Record<string, unknown>;
      agent?: string;
    }
  | { kind: "system"; id: string; text: string }
  | {
      kind: "result";
      id: string;
      cost: number;
      durationMs: number;
      isError: boolean;
    };
```

Then in each case of `reduceSandboxEvent` that creates these items, pass through `event.agent`:

For `case "text"` — when creating a new assistant item, add `agent: (event as any).agent ?? sessionKey`.
For `case "thinking"` — same pattern.
For `case "tool_use"` — add `agent: (event as any).agent ?? sessionKey`.
For `case "tool_log"` — add `agent: (event as any).agent ?? sessionKey`.

Use `getSessionKey(event)` which already returns `event.agent ?? "main"` as the fallback.

**Step 4: Run test to verify it passes**

Run: `bun test tests/reduce-sandbox-event.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add web/lib/reduce-sandbox-event.ts tests/reduce-sandbox-event.test.ts
git commit -m "feat(web): propagate agent name into timeline items"
```

---

### Task 3: Enhance Chat Rendering — Thinking Collapsible

Add a collapsible component for thinking items in the chat view.

**Files:**
- Modify: `web/components/fragments/chat.tsx`

**Step 1: Add collapsible thinking component**

In `chat.tsx`, add a small inline component and update the rendering logic:

```tsx
import { ChevronRight } from "lucide-react";

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
        />
        <span>{streaming ? "Thinking..." : "Thought process"}</span>
      </button>
      {expanded ? (
        <div className="border-t border-border/40 px-3 py-2 text-xs leading-5 text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      ) : null}
    </div>
  );
}
```

Add `useState` to the imports at the top. Add `ChevronRight` to lucide-react imports.

**Step 2: Update the main render to use ThinkingBlock**

In the `items.map()` block, add a branch for thinking items:

```tsx
if (item.kind === "thinking") {
  return (
    <div key={item.id} className="w-full px-1">
      <ThinkingBlock text={item.text} streaming={item.streaming} />
    </div>
  );
}
```

Place this before the main `<div>` return so thinking items get their own rendering path.

**Step 3: Verify in browser**

Navigate to http://127.0.0.1:3000 (or 3001), send a message that triggers thinking, verify the collapsible appears.

**Step 4: Commit**

```bash
git add web/components/fragments/chat.tsx
git commit -m "feat(web): add collapsible thinking display in chat"
```

---

### Task 4: Enhance Chat Rendering — Tool Call Cards

Add card-style rendering for tool_use and tool_log items.

**Files:**
- Modify: `web/components/fragments/chat.tsx`

**Step 1: Add ToolCallCard component**

```tsx
import { Wrench } from "lucide-react";

function ToolCallCard({ tool, toolCallId, agent }: { tool: string; toolCallId: string; agent?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#ff8800]/30 bg-[#ff8800]/5 px-3 py-2">
      <Wrench className="h-3.5 w-3.5 text-[#ff8800]" />
      <span className="text-xs font-medium text-foreground">{tool}</span>
      {agent && agent !== "main" ? (
        <span className="rounded-full bg-[#ff8800]/15 px-2 py-0.5 text-[10px] text-[#ff8800]">
          {agent}
        </span>
      ) : null}
      <span className="ml-auto text-[10px] font-mono text-muted-foreground">{toolCallId}</span>
    </div>
  );
}
```

**Step 2: Update rendering for tool_use items**

In the `items.map()`, add before the main return:

```tsx
if (item.kind === "tool_use") {
  return (
    <div key={item.id} className="w-full px-1">
      <ToolCallCard tool={item.tool} toolCallId={item.toolCallId} agent={item.agent} />
    </div>
  );
}
```

**Step 3: Add Agent badge to assistant messages**

In the existing assistant rendering branch, add an agent badge above the title:

```tsx
{!isUser && (
  <div className="flex items-start justify-between gap-3">
    <div className="flex items-center gap-2">
      {"agent" in item && item.agent && item.agent !== "main" ? (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          {item.agent}
        </span>
      ) : null}
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {presentation.title}
      </div>
    </div>
    {presentation.meta ? (
      <div className="text-[11px] text-muted-foreground">{presentation.meta}</div>
    ) : null}
  </div>
)}
```

**Step 4: Verify in browser**

Send a message that triggers tool use and verify tool cards render with orange border.

**Step 5: Commit**

```bash
git add web/components/fragments/chat.tsx
git commit -m "feat(web): add tool call cards and agent badges to chat"
```

---

### Task 5: Slash Command Dropdown

Add a command palette that appears when the user types `/` in the chat input.

**Files:**
- Create: `web/components/fragments/slash-menu.tsx`
- Modify: `web/components/fragments/chat-input.tsx`
- Modify: `web/components/app-shell.tsx`

**Step 1: Create the slash menu component**

```tsx
// web/components/fragments/slash-menu.tsx
"use client";

import { cn } from "@/lib/utils";

export interface SlashMenuItem {
  command: string;
  description: string;
  hasArg?: boolean;
}

export const SLASH_COMMANDS: SlashMenuItem[] = [
  { command: "/enter", description: "Switch to an agent", hasArg: true },
  { command: "/exit", description: "Return to main agent" },
  { command: "/agents", description: "List available agents" },
  { command: "/skills", description: "List skills for current agent" },
  { command: "/status", description: "Request agent status" },
  { command: "/stop", description: "Interrupt current generation" },
  { command: "/clear", description: "Clear local timeline" },
  { command: "/resume", description: "Resume a session by ID", hasArg: true },
  { command: "/model", description: "Show fixed model" },
  { command: "/help", description: "Show all commands" },
];

export function SlashMenu({
  filter,
  onSelect,
  selectedIndex,
}: {
  filter: string;
  onSelect(command: string): void;
  selectedIndex: number;
}) {
  const filtered = SLASH_COMMANDS.filter((item) =>
    item.command.startsWith(filter.toLowerCase()),
  );

  if (filtered.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-0 z-50 mb-1 w-full max-w-sm rounded-lg border bg-popover p-1 shadow-lg">
      {filtered.map((item, index) => (
        <button
          key={item.command}
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent",
            index === selectedIndex && "bg-accent",
          )}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item.command + (item.hasArg ? " " : ""));
          }}
        >
          <span className="font-mono text-xs text-[#ff8800]">{item.command}</span>
          <span className="text-xs text-muted-foreground">{item.description}</span>
        </button>
      ))}
    </div>
  );
}
```

**Step 2: Write a test for the slash menu filtering**

```typescript
// tests/web/slash-menu.test.ts
import { describe, it, expect } from "vitest";
import { SLASH_COMMANDS } from "../../web/components/fragments/slash-menu";

describe("SLASH_COMMANDS", () => {
  it("should contain all documented commands", () => {
    const commands = SLASH_COMMANDS.map((c) => c.command);
    expect(commands).toContain("/enter");
    expect(commands).toContain("/exit");
    expect(commands).toContain("/help");
    expect(commands).toContain("/clear");
    expect(commands).toContain("/resume");
  });

  it("should filter correctly", () => {
    const filtered = SLASH_COMMANDS.filter((item) =>
      item.command.startsWith("/e"),
    );
    expect(filtered.map((c) => c.command)).toEqual(["/enter", "/exit"]);
  });
});
```

**Step 3: Run test**

Run: `bun test tests/web/slash-menu.test.ts`
Expected: PASS

**Step 4: Integrate into chat-input.tsx**

Add slash menu state management to `ChatInput`:
- Track whether input starts with `/`
- Show `SlashMenu` component above the input
- Handle arrow key navigation and Enter to select
- On select, replace input text with the chosen command

Add a new prop `onSlashSelect` to `ChatInput` and wire it in `app-shell.tsx`.

**Step 5: Commit**

```bash
git add web/components/fragments/slash-menu.tsx tests/web/slash-menu.test.ts web/components/fragments/chat-input.tsx web/components/app-shell.tsx
git commit -m "feat(web): add slash command dropdown menu"
```

---

### Task 6: Clean Up Fragments Remnants

The browser screenshot shows "Star on GitHub" banner, "Auto" template selector, "Claude Sonnet 4" model dropdown — these are from the original Fragments UI. Our code doesn't have them, so they might be in a cached build. Verify and clean up.

**Files:**
- Modify: `web/components/fragments/chat-input.tsx` (if remnants found)
- Modify: `web/components/fragments/navbar.tsx`

**Step 1: Check for remnant components**

Search for "Star on GitHub", "Auto", template/model references across the web/ directory. If found in our codebase, remove them. If not found, the issue is likely a stale build — run `bun run build` in the web directory to force a clean build.

**Step 2: Update navbar branding**

In `web/components/fragments/navbar.tsx`, change:
- "AgentOS by " + "Fragments UI" → "AgentOS Workbench"
- Remove the Fragments-specific styling

```tsx
<div className="flex items-center gap-2">
  <Logo style="fragments" width={22} height={22} />
  <h1 className="whitespace-pre text-sm font-medium md:text-base">AgentOS Workbench</h1>
</div>
```

Remove the `<span>` with "Fragments UI".

**Step 3: Commit**

```bash
git add web/components/fragments/navbar.tsx
git commit -m "fix(web): clean up Fragments remnants, update branding"
```

---

### Task 7: Verify Auth Pipeline End-to-End

Verify the full auth flow works: frontend creates session → token stored → WebSocket connects with token → backend validates.

**Files:**
- Verify: `web/lib/auth-session.ts`, `web/hooks/use-sandbox-connection.ts`, `src/server.ts`, `src/auth.ts`
- Test: `tests/web/auth-session.test.ts`, `tests/auth.test.ts`

**Step 1: Run existing auth tests**

Run: `bun test tests/auth.test.ts tests/web/auth-session.test.ts`
Expected: All PASS

**Step 2: Verify WebSocket token flow**

In `web/hooks/use-sandbox-connection.ts`, the `getWebSocketUrl` function already calls `appendAuthToken` to add `?token=...` to the WebSocket URL. In `src/server.ts`, the `upgrade` handler calls `requireUserId(req, reqUrl, authSecret)` which reads from query params. This chain is complete.

**Step 3: Verify REST API auth headers**

In `web/lib/auth-session.ts`, `buildAuthHeaders` returns `{ authorization: "Bearer <token>" }`. In `src/server.ts`, `getBearerToken` parses `Authorization: Bearer <token>`. This chain is complete.

**Step 4: Manual E2E test**

Open browser → Network tab → verify:
1. `POST /api/auth/session` returns token + userId
2. WebSocket connects to `/ws/<projectId>?token=<token>`
3. File tree API calls include `Authorization: Bearer <token>` header

**Step 5: Commit (if any fixes needed)**

```bash
git commit -m "fix(web): auth pipeline adjustments"
```

---

### Task 8: Verify E2B File Operations Alignment

Ensure file browser, preview, upload all work correctly with the backend REST API.

**Files:**
- Verify: `web/components/workbench/file-browser.tsx`, `web/components/workbench/preview-pane.tsx`
- Verify: `web/lib/file-upload.ts`, `web/hooks/use-file-tree.ts`

**Step 1: Run existing file-related tests**

Run: `bun test tests/web/file-upload.test.ts`
Expected: PASS

**Step 2: Verify file tree rendering**

After Task 1 (workbench visible), navigate to the Files tab. Verify:
- Directory tree loads from `/api/projects/<id>/files/tree`
- Clicking a file triggers preview via `/api/projects/<id>/files/read`
- Text files show in code view, images show in preview, markdown renders

**Step 3: Verify file upload flow**

Click "Upload" in the file browser → select a file → verify it uploads via `/api/projects/<id>/files/upload` and the tree refreshes.

**Step 4: Commit (if any fixes needed)**

```bash
git commit -m "fix(web): e2b file operations alignment"
```

---

### Task 9: Run Full Test Suite and Final Verification

**Step 1: Run all unit tests**

Run: `bun test`
Expected: All PASS

**Step 2: Run linter**

Run: `bun run lint`
Expected: No errors

**Step 3: Build frontend**

Run: `cd web && bun run build`
Expected: Build succeeds

**Step 4: Manual smoke test**

Open http://127.0.0.1:3001 and verify:
1. Left chat + right workbench visible
2. Resizable splitter works
3. Send a message → assistant response shows with agent badge
4. Thinking content appears as collapsible
5. Tool calls appear as orange cards
6. Type `/` → slash menu appears
7. File browser loads, clicking files shows preview
8. Timeline tab shows activity feed

**Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(web): complete UI enhancement — layout, chat, slash commands, auth alignment"
```
