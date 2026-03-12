# Web UI Enhancement Design

Date: 2026-03-10

## Overview

Incremental enhancement of the AgentOS-TS web frontend to achieve full feature parity with the CLI sandbox mode (`bun start`). The approach follows "progressive patching" — fixing and enhancing existing components with minimal invasive changes.

## 1. Layout & Workbench Visibility

**Problem**: Right-side workbench panel (file browser, preview, activity feed) exists in code but is invisible in the browser.

**Solution**: Fix CSS class issues in `app-shell.tsx` to ensure the workbench panel renders on desktop. The resizable splitter and tab system are already implemented.

**Files**: `web/components/app-shell.tsx`

## 2. Chat Message Enhancement

**Problem**: Timeline items (thinking, tool_use, tool_log) display as flat text blocks without visual hierarchy.

**Solution**: Enhance `chat.tsx` with inline components:
- **Agent badge**: Colored label on assistant messages showing agent name (from `event.agent`)
- **ThinkingCollapsible**: Collapsed by default, shows "Thinking..." label, click to expand
- **ToolCallCard**: Card with tool icon, name, toolCallId, orange border
- **ToolLogBlock**: Nested under tool card, retains pre block with phase indicator

**Data change**: Add `agent?: string` field to `TimelineItem` types that support it.

**Files**: `web/components/fragments/chat.tsx`, `web/lib/reduce-sandbox-event.ts`, `web/lib/timeline-presenter.ts`

## 3. Chat Input Toolbar Overhaul

**Problem**: Original Fragments UI elements (Auto template selector, model dropdown) still visible. Missing slash command autocomplete.

**Solution**:
- Remove Fragments-era template/model selectors
- Agent selector: Show current agent name as badge, click to expand agent list (reuse AgentTabs)
- Fixed model display: Keep existing `fixedModel` badge
- Slash command dropdown: Monitor input starting with `/`, show command palette popup with all available commands

**Files**: `web/components/fragments/chat-input.tsx`, `web/components/app-shell.tsx`

## 4. Auth Pipeline

**Problem**: Guest token exists in `auth.ts` but needs full pipeline verification.

**Solution**: Ensure auth flow: frontend `auth-session.ts` → REST session creation → token in sessionStorage → WebSocket connection with token → backend validation on every request.

**Files**: `web/lib/auth-session.ts`, `web/app/runtime-provider.tsx`, `src/server.ts`

## 5. E2B Alignment

**Problem**: File preview, directory tree interaction, and project isolation need verification against CLI capabilities.

**Solution**:
- File browser click → preview pane shows content (text/image/code)
- Project isolation via `projectId` scoping (already in session-store)
- Multi-agent session persistence via `session_id` in result events

**Files**: `web/components/workbench/file-browser.tsx`, `web/components/workbench/preview-pane.tsx`, `src/session-store.ts`

## 6. Gap Analysis (CLI vs Web)

| CLI Feature | Web Status | Action |
|------------|-----------|--------|
| thinking events | Protocol+Reducer OK | Enhance UI display |
| tool_use/tool_log events | Protocol+Reducer OK | Enhance UI display |
| File system access | REST API OK | Fix workbench visibility |
| Agent manifest | /agents /skills OK | Verify integration |
| Session resume | /resume command OK | Verify E2E flow |
| interrupt | /stop command OK | No change needed |
| History restore | Reducer handles history event | Verify E2E flow |

## Implementation Priority

1. **P0**: Layout fix (workbench visibility) — unblocks all workbench features
2. **P0**: Chat message enhancement (thinking/tool_use display) — core UX
3. **P1**: Chat input overhaul (remove Fragments remnants, add slash dropdown)
4. **P1**: Auth pipeline verification
5. **P2**: E2B alignment and gap verification
