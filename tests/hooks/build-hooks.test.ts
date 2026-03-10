// input: buildHooks assembly function
// output: Tests for hook pipeline construction and composition
// pos: Unit test — validates hook registry wiring

import { describe, it, expect } from "vitest";
import { buildHooks } from "../../src/hooks/index.js";

describe("buildHooks", () => {
  it("returns PreToolUse and PostToolUse arrays", () => {
    const hooks = buildHooks();
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
    expect(Array.isArray(hooks.PreToolUse)).toBe(true);
    expect(Array.isArray(hooks.PostToolUse)).toBe(true);
  });

  it("PreToolUse has 3 hook entries (schema, budget, logger)", () => {
    const hooks = buildHooks();
    expect(hooks.PreToolUse.length).toBe(3);
  });

  it("PostToolUse has 1 hook entry (logger)", () => {
    const hooks = buildHooks();
    expect(hooks.PostToolUse.length).toBe(1);
  });

  it("each hook entry has hooks array", () => {
    const hooks = buildHooks();
    for (const entry of hooks.PreToolUse) {
      expect(entry.hooks).toBeDefined();
      expect(Array.isArray(entry.hooks)).toBe(true);
      expect(entry.hooks.length).toBeGreaterThan(0);
      for (const fn of entry.hooks) {
        expect(typeof fn).toBe("function");
      }
    }
    for (const entry of hooks.PostToolUse) {
      expect(entry.hooks).toBeDefined();
      expect(Array.isArray(entry.hooks)).toBe(true);
    }
  });

  it("budget hook respects custom maxBudgetUsd", async () => {
    const hooks = buildHooks(undefined, 0.001);
    // The second PreToolUse entry is the budget hook
    const budgetHook = hooks.PreToolUse[1].hooks[0];
    // Since the budget tracker hasn't recorded any cost yet, it should allow
    const result = await budgetHook({
      tool_name: "Read",
      tool_input: {},
    });
    expect(result.permissionDecision).toBeUndefined();
  });

  it("schema validator hook is first in PreToolUse", async () => {
    const hooks = buildHooks();
    const schemaHook = hooks.PreToolUse[0].hooks[0];
    // Non-write tool should pass through
    const result = await schemaHook({
      tool_name: "Read",
      tool_input: {},
    });
    expect(result.permissionDecision).toBeUndefined();
  });
});
