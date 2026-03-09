import { describe, it, expect } from "vitest";
import { createBudgetTracker, budgetGuard } from "../../src/hooks/cost-guard.js";

describe("createBudgetTracker", () => {
  it("allows tool use when under budget", async () => {
    const tracker = createBudgetTracker(10.0);
    const result = await tracker.preToolUse({ tool_name: "Read", tool_input: {} });
    expect(result.permissionDecision).toBeUndefined();
  });

  it("denies tool use when budget exceeded", async () => {
    const tracker = createBudgetTracker(0.01);
    tracker.recordCost(0.02);
    const result = await tracker.preToolUse({ tool_name: "Read", tool_input: {} });
    expect(result.permissionDecision).toBe("deny");
    expect(result.reason).toContain("budget");
  });

  it("tracks cumulative cost", async () => {
    const tracker = createBudgetTracker(0.05);
    tracker.recordCost(0.02);
    tracker.recordCost(0.02);
    let result = await tracker.preToolUse({ tool_name: "Read", tool_input: {} });
    expect(result.permissionDecision).toBeUndefined();

    tracker.recordCost(0.02);
    result = await tracker.preToolUse({ tool_name: "Read", tool_input: {} });
    expect(result.permissionDecision).toBe("deny");
  });

  it("reports spent amount", () => {
    const tracker = createBudgetTracker(10);
    tracker.recordCost(1.5);
    tracker.recordCost(2.3);
    expect(tracker.spent()).toBeCloseTo(3.8);
  });
});

describe("budgetGuard (default)", () => {
  it("allows by default (high threshold)", async () => {
    const result = await budgetGuard({ tool_name: "Bash", tool_input: {} });
    expect(result.permissionDecision).toBeUndefined();
  });
});
