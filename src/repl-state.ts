// input: SandboxEvent stream from orchestrator
// output: Immutable REPL state transitions and delegation log lines
// pos: REPL state machine — tracks active agent, stream type, and todo list

import type { SandboxEvent, TodoItem } from "./protocol.js";
import { createMarkdownState, type MarkdownState } from "./repl-markdown.js";

export interface ReplState {
  activeAgent: string | null;
  busy: boolean;
  textStarted: boolean;
  activeStream: "text" | "thinking" | null;
  markdownState: MarkdownState;
  todos: TodoItem[];
}

export function createInitialReplState(): ReplState {
  return {
    activeAgent: null,
    busy: false,
    textStarted: false,
    activeStream: null,
    markdownState: createMarkdownState(),
    todos: [],
  };
}

export function applyReplEvent(
  state: ReplState,
  event: SandboxEvent,
): { state: ReplState; logs: string[] } {
  if (event.type === "agent_entered") {
    return {
      state: {
        ...state,
        activeAgent: event.agent,
      },
      logs:
        event.reason === "delegation" && event.parent_agent
          ? [`  \u23fa delegated ${event.parent_agent} \u2192 ${event.agent}`]
          : [],
    };
  }

  if (event.type === "agent_exited") {
    return {
      state: {
        ...state,
        activeAgent: null,
      },
      logs:
        event.reason === "return" && event.parent_agent
          ? [`  \u23fa returned ${event.agent} \u2192 ${event.parent_agent}`]
          : [],
    };
  }

  return { state, logs: [] };
}
