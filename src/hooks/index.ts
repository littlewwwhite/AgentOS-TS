// input: Individual hook modules + workspace root path
// output: hooks config for ClaudeAgentOptions.hooks (REPL or sandbox mode)
// pos: Registry — assembles all hooks into SDK-compatible structure

import { schemaValidator } from "./schema-validator.js";
import { budgetGuard } from "./cost-guard.js";
import { createToolLogger } from "./tool-logger.js";
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

/** @deprecated Use buildSandboxHooks() for E2B sandbox mode */
export function buildHooks(workspaceRoot?: string) {
  return {
    PreToolUse: [
      { hooks: [schemaValidator] },
      { hooks: [budgetGuard] },
      { hooks: [logToolIntent] },
    ],
    PostToolUse: [{ hooks: [logToolResult] }],
    UserPromptSubmit: [{ hooks: [todoNag] }],
    PreCompact: [{ hooks: [makePreCompactGuide(workspaceRoot)] }],
  };
}

/** Sandbox-only hooks: schema validation + budget guard + emit-based tool logger */
export function buildSandboxHooks(agentName?: string) {
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
