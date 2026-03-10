import type { SandboxEvent } from "./protocol.js";

export interface ReplState {
  activeAgent: string | null;
  busy: boolean;
  textStarted: boolean;
  activeStream: "text" | "thinking" | null;
}

export function createInitialReplState(): ReplState {
  return {
    activeAgent: null,
    busy: false,
    textStarted: false,
    activeStream: null,
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
          ? [`  ⏺ delegated ${event.parent_agent} → ${event.agent}`]
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
          ? [`  ⏺ returned ${event.agent} → ${event.parent_agent}`]
          : [],
    };
  }

  return { state, logs: [] };
}
