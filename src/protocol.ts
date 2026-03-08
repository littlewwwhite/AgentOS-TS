// input: None (pure type definitions)
// output: SandboxCommand, SandboxEvent types + emit/parse helpers
// pos: Protocol contract — shared between sandbox.ts and future backend proxy

// ---------- Commands (stdin → sandbox) ----------

export type ChatCommand = { cmd: "chat"; message: string };
export type InterruptCommand = { cmd: "interrupt" };
export type StatusCommand = { cmd: "status" };
export type ListSkillsCommand = { cmd: "list_skills" };

export type SandboxCommand =
  | ChatCommand
  | InterruptCommand
  | StatusCommand
  | ListSkillsCommand;

// ---------- Events (sandbox → stdout) ----------

export type ReadyEvent = { type: "ready"; skills: string[] };
export type TextEvent = { type: "text"; text: string };
export type ToolUseEvent = { type: "tool_use"; tool: string; id: string };
export type ResultEvent = {
  type: "result";
  cost: number;
  duration_ms: number;
  session_id: string;
  is_error: boolean;
};
export type ErrorEvent = { type: "error"; message: string };
export type StatusEvent = {
  type: "status";
  state: "idle" | "busy";
  session_id?: string;
};
export type SkillsEvent = { type: "skills"; skills: Record<string, string> };

export type SandboxEvent =
  | ReadyEvent
  | TextEvent
  | ToolUseEvent
  | ResultEvent
  | ErrorEvent
  | StatusEvent
  | SkillsEvent;

// ---------- Helpers ----------

const VALID_CMDS = new Set(["chat", "interrupt", "status", "list_skills"]);

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

  if (obj.cmd === "chat") {
    if (typeof obj.message !== "string" || !obj.message) return null;
    return { cmd: "chat", message: obj.message };
  }

  return { cmd: obj.cmd } as SandboxCommand;
}
