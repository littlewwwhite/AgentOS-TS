// input: Individual hook modules + workspace root path
// output: hooks config for ClaudeAgentOptions.hooks (sandbox mode)
// pos: Registry — assembles all hooks into SDK-compatible structure

import { schemaValidator } from "./schema-validator.js";
import { createBudgetTracker } from "./cost-guard.js";
import { createToolLogger } from "./tool-logger.js";

/** Sandbox hooks: schema validation + per-session budget guard + emit-based tool logger */
export function buildHooks(agentName?: string, maxBudgetUsd = 10.0) {
  const budget = createBudgetTracker(maxBudgetUsd);
  const logger = createToolLogger(agentName);
  return {
    PreToolUse: [
      { hooks: [schemaValidator] },
      { hooks: [budget.preToolUse] },
      { hooks: [logger.preToolUse] },
    ],
    PostToolUse: [{ hooks: [logger.postToolUse] }],
  };
}
