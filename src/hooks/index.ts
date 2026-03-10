// input: Individual hook modules + workspace root path
// output: hooks config for ClaudeAgentOptions.hooks (sandbox mode)
// pos: Registry — assembles all hooks into SDK-compatible structure

import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";

import { schemaValidator } from "./schema-validator.js";
import { createToolLogger } from "./tool-logger.js";

/** Sandbox hooks: schema validation + emit-based tool logger. Budget is SDK-native maxBudgetUsd. */
export function buildHooks(): NonNullable<Options["hooks"]> {
  const logger = createToolLogger();
  return {
    PreToolUse: [{ hooks: [schemaValidator as HookCallback, logger.preToolUse as HookCallback] }],
    PostToolUse: [{ hooks: [logger.postToolUse as HookCallback] }],
  };
}
