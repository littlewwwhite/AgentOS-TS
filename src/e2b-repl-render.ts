import type { ReplState } from "./e2b-repl-state.js";
import type { SandboxEvent } from "./protocol.js";

export interface ReplPalette {
  dim: (text: string) => string;
  cyan: (text: string) => string;
  yellow: (text: string) => string;
  red: (text: string) => string;
}

function formatToolLabel(name: string, input?: Record<string, unknown>): string {
  if (!input) return name;
  if (name === "Bash") {
    if (typeof input.description === "string" && input.description.length > 0) {
      return `Bash(${input.description})`;
    }
    if (typeof input.command === "string") {
      const short = input.command.length > 60 ? `${input.command.slice(0, 57)}...` : input.command;
      return `Bash(${short})`;
    }
    return "Bash";
  }
  if (name === "Agent" || name === "Task") {
    const agentName = input.subagent_type ?? input.name ?? input.agent ?? null;
    const desc = typeof input.description === "string" ? input.description.slice(0, 50) : "";
    if (agentName) return `${agentName}${desc ? ` - ${desc}` : ""}`;
    if (desc) return `Agent(${desc})`;
    return "Agent";
  }
  const mcpMatch = name.match(/^mcp__(\w+)__(.+)$/);
  if (mcpMatch) {
    const [, server, tool] = mcpMatch;
    const params = Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null)
      .slice(0, 3)
      .map(([key, value]) => {
        const serialized =
          typeof value === "string"
            ? value.length > 30
              ? `"${value.slice(0, 30)}..."`
              : `"${value}"`
            : JSON.stringify(value);
        return `${key}: ${serialized}`;
      })
      .join(", ");
    return `${server}:${tool}${params ? `(${params})` : ""}`;
  }
  const arg =
    input.file_path ??
    input.command ??
    input.pattern ??
    input.url ??
    (typeof input.prompt === "string" ? input.prompt.slice(0, 60) : null) ??
    "";
  if (arg) {
    const short = typeof arg === "string" && arg.length > 60 ? `${arg.slice(0, 57)}...` : arg;
    return `${name}(${short})`;
  }
  return name;
}

function summarizeToolLog(detail?: Record<string, unknown>): string {
  if (!detail) return "tool event";
  if (typeof detail.summary === "string") {
    return detail.summary;
  }
  const status = typeof detail.status === "string" ? detail.status : null;
  const elapsed =
    typeof detail.elapsed_time_seconds === "number"
      ? ` (${detail.elapsed_time_seconds.toFixed(1)}s)`
      : "";
  if (status) {
    return `${status}${elapsed}`;
  }
  return JSON.stringify(detail).slice(0, 120);
}

function flushActiveStream(state: ReplState): { state: ReplState; output: string[] } {
  if (!state.activeStream) {
    return { state, output: [] };
  }
  return {
    state: {
      ...state,
      textStarted: false,
      activeStream: null,
    },
    output: ["\n"],
  };
}

function appendStreamChunk(
  state: ReplState,
  label: string,
  text: string,
  kind: "text" | "thinking",
  palette: ReplPalette,
): { state: ReplState; output: string[] } {
  const output: string[] = [];
  let nextState = state;

  if (state.activeStream && state.activeStream !== kind) {
    const flushed = flushActiveStream(state);
    nextState = flushed.state;
    output.push(...flushed.output);
  }

  if (!nextState.textStarted || nextState.activeStream !== kind) {
    output.push(palette.dim(label));
  }

  output.push(text);
  return {
    state: {
      ...nextState,
      textStarted: true,
      activeStream: kind,
    },
    output,
  };
}

export function renderSandboxEvent(
  state: ReplState,
  event: SandboxEvent,
  palette: ReplPalette,
): { state: ReplState; output: string[] } {
  switch (event.type) {
    case "text": {
      const label = `[${event.agent ?? "main"}] `;
      return appendStreamChunk(state, label, event.text, "text", palette);
    }

    case "thinking": {
      const label = `[${event.agent ?? "main"} thinking] `;
      return appendStreamChunk(state, label, event.text, "thinking", palette);
    }

    case "tool_use": {
      const flushed = flushActiveStream(state);
      const indent = event.nested ? "      " : "  ";
      const label = event.agent ? palette.dim(`[${event.agent}] `) : "";
      const toolLabel = formatToolLabel(event.tool, event.input);
      return {
        state: flushed.state,
        output: [...flushed.output, `${label}${indent}${palette.cyan("\u23fb")} ${toolLabel}\n`],
      };
    }

    case "tool_log": {
      const flushed = flushActiveStream(state);
      const summary = summarizeToolLog(event.detail);
      return {
        state: flushed.state,
        output: [...flushed.output, `${palette.dim(`    \u23bf ${summary}`)}\n`],
      };
    }

    case "result": {
      const flushed = flushActiveStream({
        ...state,
        busy: false,
      });
      const cost = `$${event.cost.toFixed(4)}`;
      const duration = `${(event.duration_ms / 1000).toFixed(1)}s`;
      return {
        state: flushed.state,
        output: [...flushed.output, `\n${palette.dim(`  - ${cost} · ${duration}`)}\n`],
      };
    }

    case "error": {
      const flushed = flushActiveStream({
        ...state,
        busy: false,
      });
      return {
        state: flushed.state,
        output: [...flushed.output, `${palette.red(`  ✗ ${event.message}`)}\n`],
      };
    }

    case "status":
      return {
        state: {
          ...state,
          busy: event.state === "busy",
        },
        output: [],
      };

    case "skills": {
      const flushed = flushActiveStream(state);
      const output = [...flushed.output, `${palette.dim("  Skills:")}\n`];
      for (const [name, description] of Object.entries(event.skills)) {
        const short = description.length > 60 ? `${description.slice(0, 60)}…` : description;
        output.push(`    ${palette.cyan(name.padEnd(18))} ${palette.dim(short)}\n`);
      }
      return {
        state: flushed.state,
        output,
      };
    }

    case "system": {
      const flushed = flushActiveStream(state);
      if (event.subtype === "status" && event.detail?.status === "compacting") {
        return {
          state: flushed.state,
          output: [
            ...flushed.output,
            `  ${palette.cyan("\u23fb")} ${palette.yellow("compacting context…")}\n`,
          ],
        };
      }
      if (event.subtype === "compact_boundary" && event.detail) {
        const detail = event.detail as { trigger?: string; pre_tokens?: number };
        return {
          state: flushed.state,
          output: [
            ...flushed.output,
            `${palette.dim(`    \u23bf  compacted (${detail.trigger}, ${detail.pre_tokens} tokens before)`)}\n`,
          ],
        };
      }
      return { state: flushed.state, output: flushed.output };
    }

    case "agent_entered":
    case "agent_exited":
    case "history":
    case "ready":
      return flushActiveStream(state);

    default:
      return { state, output: [] };
  }
}
