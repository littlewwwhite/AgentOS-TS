import type { ReplState } from "./e2b-repl-state.js";
import type { SandboxEvent } from "./protocol.js";
import { createMarkdownState, transformMarkdownChunk, flushMarkdownBuffer } from "./repl-markdown.js";

export interface ReplPalette {
  dim: (text: string) => string;
  cyan: (text: string) => string;
  yellow: (text: string) => string;
  red: (text: string) => string;
  bold: (text: string) => string;
  magenta: (text: string) => string;
  green: (text: string) => string;
  badge: (name: string) => string;
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
  if (name === "Skill") {
    const skillName = typeof input.skill === "string" ? input.skill : null;
    return skillName ? `skill:${skillName}` : "Skill";
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

function formatAgentBadge(agent: string | undefined | null, palette: ReplPalette): string {
  return palette.badge(agent ?? "main");
}

function flushActiveStream(state: ReplState, palette?: ReplPalette): { state: ReplState; output: string[] } {
  if (!state.activeStream) {
    return { state, output: [] };
  }
  const output: string[] = [];
  // Flush markdown buffer when ending a text stream
  if (state.activeStream === "text" && palette) {
    const flushed = flushMarkdownBuffer(state.markdownState, palette);
    if (flushed.output) output.push(flushed.output);
  }
  output.push("\n");
  return {
    state: {
      ...state,
      textStarted: false,
      activeStream: null,
      markdownState: createMarkdownState(),
    },
    output,
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
    const flushed = flushActiveStream(state, palette);
    nextState = flushed.state;
    output.push(...flushed.output);
  }

  if (!nextState.textStarted || nextState.activeStream !== kind) {
    output.push(label);
  }

  if (kind === "text") {
    const md = transformMarkdownChunk(nextState.markdownState, text, palette);
    output.push(md.output);
    return {
      state: {
        ...nextState,
        textStarted: true,
        activeStream: kind,
        markdownState: md.state,
      },
      output,
    };
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
      const label = `${formatAgentBadge(event.agent, palette)} `;
      return appendStreamChunk(state, label, event.text, "text", palette);
    }

    case "thinking": {
      const badge = formatAgentBadge(event.agent, palette);
      const label = `${badge} ${palette.dim("thinking")}\n`;
      return appendStreamChunk(state, label, palette.dim(event.text), "thinking", palette);
    }

    case "tool_use": {
      const flushed = flushActiveStream(state, palette);
      const indent = event.nested ? "      " : "  ";
      const badge = formatAgentBadge(event.agent, palette);
      const toolLabel = formatToolLabel(event.tool, event.input);
      return {
        state: flushed.state,
        output: [...flushed.output, `${badge} ${indent}${palette.cyan("\u23fb")} ${palette.bold(toolLabel)}\n`],
      };
    }

    case "tool_log":
      // Suppressed in CLI — tool_use events already provide tool feedback.
      // tool_log events are consumed by the web frontend for detailed activity feed.
      return { state, output: [] };

    case "result": {
      const flushed = flushActiveStream({
        ...state,
        busy: false,
      }, palette);
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
      }, palette);
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
      const flushed = flushActiveStream(state, palette);
      const output = [...flushed.output, `${palette.dim("  Skills:")}\n`];
      for (const [name, detail] of Object.entries(event.skills)) {
        const desc = typeof detail === "string" ? detail : detail.description;
        const short = desc.length > 60 ? `${desc.slice(0, 60)}…` : desc;
        output.push(`    ${palette.cyan(name.padEnd(18))} ${palette.dim(short)}\n`);
      }
      return {
        state: flushed.state,
        output,
      };
    }

    case "system": {
      const flushed = flushActiveStream(state, palette);
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
      return flushActiveStream(state, palette);

    case "todo": {
      const flushed = flushActiveStream(state, palette);
      const lines = event.todos.map((t) => {
        if (t.status === "completed") return `  ${palette.green("✓")} ${palette.dim(t.content)}`;
        if (t.status === "in_progress") return `  ${palette.cyan("●")} ${t.content}`;
        return `  ${palette.dim("○")} ${palette.dim(t.content)}`;
      });
      return {
        state: { ...flushed.state, todos: event.todos },
        output: [...flushed.output, `\n${lines.join("\n")}\n`],
      };
    }

    default:
      return { state, output: [] };
  }
}
