export type ChatCommand = {
  cmd: "chat";
  message: string;
  target?: string;
  request_id?: string;
};

export type InterruptCommand = { cmd: "interrupt" };
export type StatusCommand = { cmd: "status" };
export type ListSkillsCommand = { cmd: "list_skills" };
export type EnterAgentCommand = { cmd: "enter_agent"; agent: string };
export type ExitAgentCommand = { cmd: "exit_agent" };
export type ResumeCommand = { cmd: "resume"; session_id: string };

export type SandboxCommand =
  | ChatCommand
  | InterruptCommand
  | StatusCommand
  | ListSkillsCommand
  | EnterAgentCommand
  | ExitAgentCommand
  | ResumeCommand;

export interface EventBase {
  request_id?: string;
  agent?: string;
}

export type ReadyEvent = EventBase & { type: "ready"; skills: string[] };
export type TextEvent = EventBase & { type: "text"; text: string };
export type ToolUseEvent = EventBase & { type: "tool_use"; tool: string; id: string };
export type ToolLogEvent = EventBase & {
  type: "tool_log";
  tool: string;
  phase: "pre" | "post";
  detail?: Record<string, unknown>;
};
export type ResultEvent = EventBase & {
  type: "result";
  cost: number;
  duration_ms: number;
  session_id: string;
  is_error: boolean;
};
export type ErrorEvent = EventBase & { type: "error"; message: string };
export type StatusEvent = EventBase & {
  type: "status";
  state: "idle" | "busy" | "disconnected";
  session_id?: string;
};
export type SkillsEvent = EventBase & { type: "skills"; skills: Record<string, string> };
export type AgentEnteredEvent = EventBase & {
  type: "agent_entered";
  agent: string;
  session_id?: string;
};
export type AgentExitedEvent = EventBase & {
  type: "agent_exited";
  agent: string;
};
export type HistoryEvent = EventBase & {
  type: "history";
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: number;
  }>;
};

export type SandboxEvent =
  | ReadyEvent
  | TextEvent
  | ToolUseEvent
  | ToolLogEvent
  | ResultEvent
  | ErrorEvent
  | StatusEvent
  | SkillsEvent
  | AgentEnteredEvent
  | AgentExitedEvent
  | HistoryEvent;
