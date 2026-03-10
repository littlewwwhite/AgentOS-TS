# REPL Attached Handoff Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make automatic `main -> sub-agent` handoff visible in the E2B REPL and keep delegated execution observable instead of silently collapsing everything into `main`.

**Architecture:** Keep the existing orchestrator-driven delegation model, but treat a delegated request as a visible handoff chain. The orchestrator will emit explicit handoff metadata and avoid surfacing misleading intermediate completion events. The REPL will consume those events through a small pure state/render helper so automatic handoff can print transition lines without duplicating manual `/enter` and `/exit` output.

**Tech Stack:** TypeScript, Bun, Vitest

### Task 1: Lock orchestrator handoff behavior with failing tests

**Files:**
- Modify: `tests/sandbox-orchestrator.test.ts`

**Step 1: Write the failing test**

Add a test that simulates:
- `main` receiving a user request
- `main` requesting `switch_to_agent`
- worker agent producing visible text
- worker agent requesting `return_to_main`
- `main` receiving the completion summary

The test should assert:
- delegated execution emits `agent_entered` with delegation metadata
- child-agent text is emitted during the chain
- only the final completion result is surfaced to the user for the composite request

**Step 2: Run test to verify it fails**

Run: `bun x vitest run tests/sandbox-orchestrator.test.ts`

Expected: FAIL because current orchestrator emits intermediate results and lacks handoff metadata.

### Task 2: Lock REPL handoff rendering with failing tests

**Files:**
- Create: `tests/e2b-repl-state.test.ts`
- Create: `src/e2b-repl-state.ts`

**Step 1: Write the failing test**

Add pure-state tests that assert:
- automatic `agent_entered` events print a visible handoff line and update `activeAgent`
- automatic `agent_exited` return events print a visible return line and clear `activeAgent`
- manual enter/exit events remain silent in the event renderer because REPL already prints them eagerly

**Step 2: Run test to verify it fails**

Run: `bun x vitest run tests/e2b-repl-state.test.ts`

Expected: FAIL because the helper module does not exist yet.

### Task 3: Implement orchestrator handoff semantics

**Files:**
- Modify: `src/protocol.ts`
- Modify: `src/sandbox-orchestrator.ts`

**Step 1: Add explicit handoff metadata**

Extend `agent_entered` / `agent_exited` events with optional metadata describing whether the transition is `manual`, `delegation`, or `return`.

**Step 2: Make delegated execution observable**

Adjust `processQuery()` so delegated chains do not surface a misleading intermediate `result` from the orchestrator planner turn. Preserve child-agent `text` and `tool_use` streaming so the user can observe delegated work.

**Step 3: Preserve existing manual behavior**

Keep manual `/enter` and `/exit` semantics unchanged except for adding `reason: "manual"` metadata.

### Task 4: Implement REPL handoff rendering

**Files:**
- Create: `src/e2b-repl-state.ts`
- Modify: `scripts/e2b-repl.ts`

**Step 1: Add a pure event-state reducer**

Create a helper that:
- tracks `activeAgent`, `busy`, and `textStarted`
- returns optional log lines for automatic handoff transitions

**Step 2: Wire REPL to the helper**

Update `scripts/e2b-repl.ts` to use the helper for event-driven state updates and visible automatic handoff output.

### Task 5: Verify

**Files:**
- Modify if needed: `tests/web/reduce-sandbox-event.test.ts`

**Step 1: Run focused tests**

Run:
- `bun x vitest run tests/sandbox-orchestrator.test.ts`
- `bun x vitest run tests/e2b-repl-state.test.ts`
- `bun x vitest run tests/web/reduce-sandbox-event.test.ts`

**Step 2: Run combined verification**

Run: `bun x vitest run tests/sandbox-orchestrator.test.ts tests/e2b-repl-state.test.ts tests/web/reduce-sandbox-event.test.ts`

Expected: PASS
