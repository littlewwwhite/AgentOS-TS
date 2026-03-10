// input: Claude Agent SDK hook event signatures
// output: Thin SDK-native type re-exports for local hook modules
// pos: Contracts — avoids drifting from the upstream SDK hook shape

import type {
  HookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

export type PreToolUseResult = HookJSONOutput;
export type PostToolUseResult = HookJSONOutput;
export type PreToolUseHook = (input: PreToolUseHookInput) => Promise<HookJSONOutput>;
export type PostToolUseHook = (input: PostToolUseHookInput) => Promise<HookJSONOutput>;
