// input: PreToolUse events, cost recordings from result messages
// output: Allow or deny based on cumulative cost threshold
// pos: Cost boundary — per-session budget tracking with deny on threshold

import type { HookInput, PreToolUseResult, PreToolUseHook } from "./types.js";

export interface BudgetTracker {
  preToolUse: PreToolUseHook;
  recordCost: (usd: number) => void;
  spent: () => number;
}

export function createBudgetTracker(maxBudgetUsd: number): BudgetTracker {
  let totalSpent = 0;

  return {
    preToolUse: async (_input: HookInput): Promise<PreToolUseResult> => {
      if (totalSpent >= maxBudgetUsd) {
        return {
          permissionDecision: "deny",
          reason: `Session budget exhausted: $${totalSpent.toFixed(4)} / $${maxBudgetUsd.toFixed(2)}`,
        };
      }
      return {};
    },
    recordCost: (usd: number) => {
      totalSpent += usd;
    },
    spent: () => totalSpent,
  };
}
