// input: None (pure type definitions)
// output: SandboxCommand, SandboxEvent types + emit/parse/matchEnterAgent helpers
// pos: Protocol contract — shared between sandbox.ts and REPL layers

// ---------- Commands (stdin → sandbox) ----------

export type ChatCommand = {
  cmd: "chat";
  message: string;
  target?: string;      // one-shot routing without state change
  request_id?: string;  // correlate responses in concurrent scenarios
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

// ---------- Events (sandbox → stdout) ----------

// Base fields available on all events for concurrent correlation
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
  agent: string;  // required — override EventBase's optional
  session_id?: string;
};
export type AgentExitedEvent = EventBase & {
  type: "agent_exited";
  agent: string;  // required
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

// ---------- Natural language agent entry ----------

const ENTER_RE = /^(?:进入|切换到|enter|switch\s+to)\s*(.+)$/i;

/** Match natural language patterns like "进入screenwriter" / "switch to editor" */
export function matchEnterAgent(input: string, agentNames: string[]): string | null {
  const m = input.match(ENTER_RE);
  if (!m) return null;
  const name = m[1].trim().toLowerCase();
  return agentNames.find(a => a.toLowerCase() === name) ?? null;
}

// ---------- Helpers ----------

const VALID_CMDS = new Set([
  "chat", "interrupt", "status", "list_skills",
  "enter_agent", "exit_agent", "resume",
]);

export function emit(event: SandboxEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

export function parseCommand(line: string): SandboxCommand | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.cmd !== "string" || !VALID_CMDS.has(obj.cmd)) return null;

  switch (obj.cmd) {
    case "chat": {
      if (typeof obj.message !== "string" || !obj.message) return null;
      const cmd: ChatCommand = { cmd: "chat", message: obj.message };
      if (typeof obj.target === "string" && obj.target) cmd.target = obj.target;
      if (typeof obj.request_id === "string" && obj.request_id) cmd.request_id = obj.request_id;
      return cmd;
    }
    case "enter_agent": {
      if (typeof obj.agent !== "string" || !obj.agent) return null;
      return { cmd: "enter_agent", agent: obj.agent };
    }
    case "resume": {
      if (typeof obj.session_id !== "string" || !obj.session_id) return null;
      return { cmd: "resume", session_id: obj.session_id };
    }
    case "interrupt":
      return { cmd: "interrupt" };
    case "status":
      return { cmd: "status" };
    case "list_skills":
      return { cmd: "list_skills" };
    case "exit_agent":
      return { cmd: "exit_agent" };
    default:
      return null;
  }
}
