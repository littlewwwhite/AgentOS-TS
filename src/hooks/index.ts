// input: Individual hook modules
// output: hooks config for ClaudeAgentOptions.hooks
// pos: Registry — assembles all hooks into SDK-compatible structure

export { setWorkspaceRoot, getWorkspaceRoot } from "./workspace-guard.js";

import { workspaceGuard } from "./workspace-guard.js";
import { schemaValidator } from "./schema-validator.js";
import { costGuard } from "./cost-guard.js";
import { logToolIntent, logToolResult, todoNag } from "./logger.js";

export function buildHooks() {
  return {
    PreToolUse: [
      { hooks: [workspaceGuard] },
      { hooks: [schemaValidator] },
      { hooks: [costGuard] },
      { hooks: [logToolIntent] },
    ],
    PostToolUse: [{ hooks: [logToolResult] }],
    UserPromptSubmit: [{ hooks: [todoNag] }],
  };
}
