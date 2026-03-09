// input: Individual hook modules
// output: hooks config for ClaudeAgentOptions.hooks
// pos: Registry — assembles all hooks into SDK-compatible structure

export { setWorkspaceRoot, getWorkspaceRoot } from "./workspace-guard.js";

import { workspaceGuard, getWorkspaceRoot } from "./workspace-guard.js";
import { schemaValidator } from "./schema-validator.js";
import { costGuard } from "./cost-guard.js";
import { logToolIntent, logToolResult, todoNag } from "./logger.js";

// Preserve critical context during auto-compaction
async function preCompactGuide() {
  const ws = getWorkspaceRoot();
  return {
    additionalContext: [
      "When summarizing this conversation, preserve:",
      "- Current workflow phase and progress",
      "- File paths that have been read or written",
      "- Pending tasks and decisions",
      ws ? `- Workspace: ${ws}` : null,
    ].filter(Boolean).join("\n"),
  };
}

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
    PreCompact: [{ hooks: [preCompactGuide] }],
  };
}
