// input: PreToolUse + PostToolUse events
// output: Emits tool_log events via protocol for observability
// pos: Observability — replaces console.log logger with protocol-based emit

import { emit } from "../protocol.js";
import type { HookInput, PreToolUseResult, PostToolUseResult } from "./types.js";

export interface ToolLogger {
  preToolUse: (input: HookInput) => Promise<PreToolUseResult>;
  postToolUse: (input: HookInput) => Promise<PostToolUseResult>;
}

export function createToolLogger(agentName?: string): ToolLogger {
  const base = agentName ? { agent: agentName } : {};

  return {
    preToolUse: async (input) => {
      const { tool_name, tool_input = {} } = input;
      const detail: Record<string, unknown> = {};

      if (tool_input.file_path) detail.path = tool_input.file_path;
      if (tool_input.command) detail.command = (tool_input.command as string).slice(0, 120);
      if (tool_input.pattern) detail.pattern = tool_input.pattern;
      if (tool_input.path) detail.path = tool_input.path;

      emit({
        type: "tool_log",
        tool: tool_name,
        phase: "pre",
        detail: Object.keys(detail).length > 0 ? detail : undefined,
        ...base,
      });
      return {};
    },

    postToolUse: async (input) => {
      const { tool_name } = input;
      emit({
        type: "tool_log",
        tool: tool_name,
        phase: "post",
        ...base,
      });
      return {};
    },
  };
}
