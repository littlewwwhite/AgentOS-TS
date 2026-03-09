// input: Individual hook modules + workspace root path
// output: hooks config for ClaudeAgentOptions.hooks (sandbox mode)
// pos: Registry — assembles all hooks into SDK-compatible structure

import { schemaValidator } from "./schema-validator.js";
import { budgetGuard } from "./cost-guard.js";
import { createToolLogger } from "./tool-logger.js";

/** Sandbox hooks: schema validation + budget guard + emit-based tool logger */
export function buildHooks(agentName?: string) {
  const logger = createToolLogger(agentName);
  return {
    PreToolUse: [
      { hooks: [schemaValidator] },
      { hooks: [budgetGuard] },
      { hooks: [logger.preToolUse] },
    ],
    PostToolUse: [{ hooks: [logger.postToolUse] }],
  };
}
