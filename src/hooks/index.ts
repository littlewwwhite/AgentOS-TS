// input: Individual hook modules + workspace root path
// output: hooks config for ClaudeAgentOptions.hooks
// pos: Registry — assembles all hooks into SDK-compatible structure

import { schemaValidator } from "./schema-validator.js";
import { costGuard } from "./cost-guard.js";
import { logToolIntent, logToolResult, todoNag } from "./logger.js";

// Preserve critical context during auto-compaction
function makePreCompactGuide(workspaceRoot?: string) {
  return async () => ({
    additionalContext: [
      "When summarizing this conversation, preserve:",
      "- Current workflow phase and progress",
      "- File paths that have been read or written",
      "- Pending tasks and decisions",
      workspaceRoot ? `- Workspace: ${workspaceRoot}` : null,
    ].filter(Boolean).join("\n"),
  });
}

export function buildHooks(workspaceRoot?: string) {
  return {
    PreToolUse: [
      { hooks: [schemaValidator] },
      { hooks: [costGuard] },
      { hooks: [logToolIntent] },
    ],
    PostToolUse: [{ hooks: [logToolResult] }],
    UserPromptSubmit: [{ hooks: [todoNag] }],
    PreCompact: [{ hooks: [makePreCompactGuide(workspaceRoot)] }],
  };
}
