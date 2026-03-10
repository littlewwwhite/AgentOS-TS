import type { SandboxEvent } from "./protocol";

export type ConnectionState = "connecting" | "ready" | "disconnected" | "error";

export type TimelineItem =
  | { kind: "user"; id: string; text: string; createdAt: number }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; text: string; streaming: boolean }
  | { kind: "tool_use"; id: string; tool: string; toolCallId: string }
  | {
      kind: "tool_log";
      id: string;
      tool: string;
      phase: "pre" | "post";
      detail?: Record<string, unknown>;
    }
  | { kind: "system"; id: string; text: string }
  | {
      kind: "result";
      id: string;
      cost: number;
      durationMs: number;
      isError: boolean;
    };

export type AgentTimeline = {
  messages: TimelineItem[];
  status: "idle" | "busy" | "disconnected";
  sessionId?: string;
};

export type UiState = {
  connection: ConnectionState;
  activeAgent: string | null;
  selectedAgent: string;
  availableAgents: string[];
  sessions: Record<string, AgentTimeline>;
  lastError: string | null;
  nextId: number;
};

const DEFAULT_SESSION = "main";

export function createInitialUiState(): UiState {
  return {
    connection: "connecting",
    activeAgent: null,
    selectedAgent: DEFAULT_SESSION,
    availableAgents: [DEFAULT_SESSION],
    sessions: {
      [DEFAULT_SESSION]: {
        messages: [],
        status: "idle",
      },
    },
    lastError: null,
    nextId: 0,
  };
}

function ensureSession(state: UiState, sessionKey: string): UiState {
  if (state.sessions[sessionKey]) {
    return state;
  }

  return {
    ...state,
    sessions: {
      ...state.sessions,
      [sessionKey]: {
        messages: [],
        status: "idle",
      },
    },
  };
}

function getSessionKey(event: { agent?: string }): string {
  return event.agent ?? DEFAULT_SESSION;
}

function nextItemId(state: UiState, prefix: string): [string, UiState] {
  const id = `${prefix}-${state.nextId}`;
  return [id, { ...state, nextId: state.nextId + 1 }];
}

function withAvailableAgents(state: UiState, agents: string[]): UiState {
  const uniqueAgents = [
    DEFAULT_SESSION,
    ...agents.filter((agent, index) => agents.indexOf(agent) === index),
  ];

  let next = { ...state, availableAgents: uniqueAgents };
  for (const agent of uniqueAgents) {
    next = ensureSession(next, agent);
  }
  return next;
}

function updateSession(
  state: UiState,
  sessionKey: string,
  updater: (session: AgentTimeline) => AgentTimeline,
): UiState {
  const next = ensureSession(state, sessionKey);
  const session = next.sessions[sessionKey];
  if (!session) {
    return next;
  }
  return {
    ...next,
    sessions: {
      ...next.sessions,
      [sessionKey]: updater(session),
    },
  };
}

export function reduceSandboxEvent(state: UiState, event: SandboxEvent): UiState {
  const sessionKey = getSessionKey(event);

  switch (event.type) {
    case "ready":
      return {
        ...withAvailableAgents(state, event.skills),
        connection: "ready",
      };

    case "skills":
      return withAvailableAgents(state, Object.keys(event.skills));

    case "text": {
      const sessionState = ensureSession(state, sessionKey);
      const session = sessionState.sessions[sessionKey];
      if (!session) {
        return sessionState;
      }
      const lastMessage = session.messages.at(-1);

      if (lastMessage?.kind === "assistant" && lastMessage.streaming) {
        return updateSession(sessionState, sessionKey, (currentSession) => ({
          ...currentSession,
          status: "busy",
          messages: [
            ...currentSession.messages.slice(0, -1),
            {
              ...lastMessage,
              text: `${lastMessage.text}${event.text}`,
            },
          ],
        }));
      }

      const [id, next] = nextItemId(sessionState, `assistant-${sessionKey}`);
      return updateSession(next, sessionKey, (currentSession) => ({
        ...currentSession,
        status: "busy",
        messages: [
          ...currentSession.messages,
          {
            kind: "assistant",
            id,
            text: event.text,
            streaming: true,
          },
        ],
      }));
    }

    case "thinking": {
      const sessionState = ensureSession(state, sessionKey);
      const session = sessionState.sessions[sessionKey];
      if (!session) {
        return sessionState;
      }
      const lastMessage = session.messages.at(-1);

      if (lastMessage?.kind === "thinking" && lastMessage.streaming) {
        return updateSession(sessionState, sessionKey, (currentSession) => ({
          ...currentSession,
          status: "busy",
          messages: [
            ...currentSession.messages.slice(0, -1),
            {
              ...lastMessage,
              text: `${lastMessage.text}${event.text}`,
            },
          ],
        }));
      }

      const [id, next] = nextItemId(sessionState, `thinking-${sessionKey}`);
      return updateSession(next, sessionKey, (currentSession) => ({
        ...currentSession,
        status: "busy",
        messages: [
          ...currentSession.messages,
          {
            kind: "thinking",
            id,
            text: event.text,
            streaming: true,
          },
        ],
      }));
    }

    case "tool_use": {
      const [id, next] = nextItemId(ensureSession(state, sessionKey), `tool-use-${sessionKey}`);
      return updateSession(next, sessionKey, (session) => ({
        ...session,
        status: "busy",
        messages: [
          ...session.messages,
          {
            kind: "tool_use",
            id,
            tool: event.tool,
            toolCallId: event.id,
          },
        ],
      }));
    }

    case "tool_log": {
      const [id, next] = nextItemId(ensureSession(state, sessionKey), `tool-log-${sessionKey}`);
      return updateSession(next, sessionKey, (session) => ({
        ...session,
        status: "busy",
        messages: [
          ...session.messages,
          {
            kind: "tool_log",
            id,
            tool: event.tool,
            phase: event.phase,
            detail: event.detail,
          },
        ],
      }));
    }

    case "result": {
      const [id, next] = nextItemId(ensureSession(state, sessionKey), `result-${sessionKey}`);
      return updateSession(next, sessionKey, (session) => {
        const lastAssistantIndex = [...session.messages]
          .reverse()
          .findIndex((message) => message.kind === "assistant" && message.streaming);
        const assistantIndex =
          lastAssistantIndex === -1 ? -1 : session.messages.length - lastAssistantIndex - 1;

        const messages =
          assistantIndex >= 0
            ? session.messages.map((message, index) => {
                if (index !== assistantIndex || message.kind !== "assistant") {
                  if (message.kind === "thinking" && message.streaming) {
                    return {
                      ...message,
                      streaming: false,
                    };
                  }
                  return message;
                }
                return {
                  ...message,
                  streaming: false,
                };
              })
            : session.messages;

        return {
          ...session,
          status: "idle",
          sessionId: event.session_id,
          messages: [
            ...messages,
            {
              kind: "result",
              id,
              cost: event.cost,
              durationMs: event.duration_ms,
              isError: event.is_error,
            },
          ],
        };
      });
    }

    case "history": {
      const next = ensureSession(state, sessionKey);
      return updateSession(next, sessionKey, (session) => ({
        ...session,
        status: "idle",
        messages: event.messages.map((message, index) => {
          if (message.role === "user") {
            return {
              kind: "user",
              id: `history-${sessionKey}-${index}`,
              text: message.content,
              createdAt: message.timestamp ?? index,
            } as const;
          }

          return {
            kind: "assistant",
            id: `history-${sessionKey}-${index}`,
            text: message.content,
            streaming: false,
          } as const;
        }),
      }));
    }

    case "agent_entered": {
      const [id, next] = nextItemId(ensureSession(state, sessionKey), `system-${sessionKey}`);
      return {
        ...updateSession(next, sessionKey, (session) => ({
          ...session,
          sessionId: event.session_id ?? session.sessionId,
          messages: [
            ...session.messages,
            {
              kind: "system",
              id,
              text: `Entered agent: ${event.agent}`,
            },
          ],
        })),
        activeAgent: event.agent,
      };
    }

    case "agent_exited": {
      const [id, next] = nextItemId(ensureSession(state, sessionKey), `system-${sessionKey}`);
      return {
        ...updateSession(next, sessionKey, (session) => ({
          ...session,
          messages: [
            ...session.messages,
            {
              kind: "system",
              id,
              text: `Exited agent: ${event.agent}`,
            },
          ],
        })),
        activeAgent: null,
      };
    }

    case "status": {
      const next = updateSession(ensureSession(state, sessionKey), sessionKey, (session) => ({
        ...session,
        status: event.state,
        sessionId: event.session_id ?? session.sessionId,
      }));
      return {
        ...next,
        connection: event.state === "disconnected" ? "disconnected" : next.connection,
      };
    }

    case "error": {
      const [id, next] = nextItemId(ensureSession(state, sessionKey), `system-${sessionKey}`);
      return {
        ...updateSession(next, sessionKey, (session) => ({
          ...session,
          messages: [
            ...session.messages,
            {
              kind: "system",
              id,
              text: event.message,
            },
          ],
        })),
        connection: "error",
        lastError: event.message,
      };
    }

    case "system": {
      const [id, next] = nextItemId(ensureSession(state, sessionKey), `system-${sessionKey}`);
      const detail =
        event.detail && Object.keys(event.detail).length > 0
          ? ` ${JSON.stringify(event.detail)}`
          : "";
      return updateSession(next, sessionKey, (session) => ({
        ...session,
        messages: [
          ...session.messages,
          {
            kind: "system",
            id,
            text: `${event.subtype}${detail}`,
          },
        ],
      }));
    }
  }
}
