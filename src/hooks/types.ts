// input: Claude Agent SDK hook event signatures
// output: Typed hook function interfaces
// pos: Contracts — shared types for all hook modules

export interface HookInput {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
}

export interface PreToolUseResult {
  permissionDecision?: "allow" | "deny";
  reason?: string;
  additionalContext?: string;
}

export interface PostToolUseResult {
  additionalContext?: string;
  updatedMCPToolOutput?: unknown;
}

export type PreToolUseHook = (input: HookInput) => Promise<PreToolUseResult>;
export type PostToolUseHook = (input: HookInput) => Promise<PostToolUseResult>;
