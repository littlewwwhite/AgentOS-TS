// input: PreToolUse + PostToolUse events
// output: Emits tool_log events via protocol for observability
// pos: Observability — replaces console.log logger with protocol-based emit

import { emit } from "../protocol.js";
import type {
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { PostToolUseResult, PreToolUseResult } from "./types.js";

export interface ToolLogger {
  preToolUse: (input: PreToolUseHookInput) => Promise<PreToolUseResult>;
  postToolUse: (input: PostToolUseHookInput) => Promise<PostToolUseResult>;
}

function buildDetail(
  input: Pick<PreToolUseHookInput | PostToolUseHookInput, "cwd" | "session_id" | "tool_use_id" | "transcript_path" | "tool_input">,
): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    session_id: input.session_id,
    cwd: input.cwd,
    tool_use_id: input.tool_use_id,
    transcript_path: input.transcript_path,
  };

  const toolInput =
    typeof input.tool_input === "object" && input.tool_input !== null
      ? (input.tool_input as Record<string, unknown>)
      : {};

  if (typeof toolInput.file_path === "string") detail.path = toolInput.file_path;
  if (typeof toolInput.command === "string") detail.command = toolInput.command.slice(0, 120);
  if (typeof toolInput.pattern === "string") detail.pattern = toolInput.pattern;
  if (typeof toolInput.path === "string") detail.path = toolInput.path;

  return detail;
}

export function createToolLogger(): ToolLogger {
  return {
    preToolUse: async (input) => {
      emit({
        ...(input.agent_type ? { agent: input.agent_type } : {}),
        type: "tool_log",
        tool: input.tool_name,
        phase: "pre",
        detail: buildDetail(input),
      });
      return {};
    },

    postToolUse: async (input) => {
      emit({
        ...(input.agent_type ? { agent: input.agent_type } : {}),
        type: "tool_log",
        tool: input.tool_name,
        phase: "post",
        detail: buildDetail(input),
      });
      return {};
    },
  };
}
