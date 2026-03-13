// input: SandboxEvent + ReplState + palette
// output: ANSI-formatted terminal output lines
// pos: Event renderer — transforms protocol events into human-readable CLI output

import type { ReplState } from "./state.js";
import type { SandboxEvent } from "../protocol.js";
import { createMarkdownState, transformMarkdownChunk, flushMarkdownBuffer } from "./markdown.js";

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

// ---------- Terminal width ----------

/** Available width for content, accounting for badge/indent overhead. */
function contentWidth(): number {
  return (process.stdout.columns ?? 80) - 16;
}

function truncate(text: string, maxLen?: number): string {
  const limit = maxLen ?? contentWidth();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

// ---------- Tool label formatting ----------

function formatToolLabel(name: string, input?: Record<string, unknown>): string {
  const maxLen = contentWidth();
  if (!input) return name;

  if (name === "Bash") {
    if (typeof input.description === "string" && input.description.length > 0) {
      return `Bash(${truncate(input.description, maxLen - 6)})`;
    }
    if (typeof input.command === "string") {
      return `Bash(${truncate(input.command, maxLen - 6)})`;
    }
    return "Bash";
  }
  if (name === "Skill") {
    const skillName = typeof input.skill === "string" ? input.skill : null;
    return skillName ? `skill:${skillName}` : "Skill";
  }
  if (name === "Agent" || name === "Task") {
    const agentName = input.subagent_type ?? input.name ?? input.agent ?? null;
    const desc = typeof input.description === "string" ? truncate(input.description, 50) : "";
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
    return truncate(`${server}:${tool}${params ? `(${params})` : ""}`, maxLen);
  }
  const arg =
    input.file_path ??
    input.command ??
    input.pattern ??
    input.url ??
    (typeof input.prompt === "string" ? input.prompt.slice(0, maxLen) : null) ??
    "";
  if (arg) {
    return `${name}(${truncate(String(arg), maxLen - name.length - 2)})`;
  }
  return name;
}

// ---------- Badge ----------

function formatAgentBadge(agent: string | undefined | null, palette: ReplPalette): string {
  return palette.badge(agent ?? "main");
}

// ---------- Stream management ----------

function flushActiveStream(state: ReplState, palette?: ReplPalette): { state: ReplState; output: string[] } {
  if (!state.activeStream) {
    return { state, output: [] };
  }
  const output: string[] = [];
  if (state.activeStream === "text" && palette) {
    const flushed = flushMarkdownBuffer(state.markdownState, palette);
    if (flushed.output) output.push(flushed.output);
  }
  // Thinking flush: summary is handled by the emitter (index.ts) via spinner.
  // Just reset state here, no output.
  output.push("\n");
  return {
    state: {
      ...state,
      textStarted: false,
      activeStream: null,
      markdownState: createMarkdownState(),
      // Keep thinking accumulator — emitter reads it to show summary
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

// ---------- Main renderer ----------

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
      // Collapsed rendering: accumulate chars silently, spinner managed by emitter
      const prev = state.thinking;
      const now = Date.now();
      return {
        state: {
          ...state,
          activeStream: "thinking",
          thinking: {
            chars: (prev?.chars ?? 0) + event.text.length,
            startedAt: prev?.startedAt ?? now,
          },
        },
        output: [],
      };
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
      return { state, output: [] };

    case "result": {
      const newTotal = state.totalCost + event.cost;
      const flushed = flushActiveStream({
        ...state,
        busy: false,
        totalCost: newTotal,
      }, palette);
      const cost = `$${event.cost.toFixed(4)}`;
      const total = `$${newTotal.toFixed(4)}`;
      const duration = `${(event.duration_ms / 1000).toFixed(1)}s`;
      return {
        state: { ...flushed.state, totalCost: newTotal },
        output: [...flushed.output, `\n${palette.dim(`  - ${cost} \u00b7 ${duration} \u00b7 total: ${total}`)}\n`],
      };
    }

    case "error": {
      const flushed = flushActiveStream({
        ...state,
        busy: false,
      }, palette);
      // Format multi-line errors and truncate excessively long messages
      const msg = event.message;
      const lines = msg.split("\n");
      const formatted = lines.length > 1
        ? `  \u2717 ${lines[0]}\n${lines.slice(1, 8).map((l) => `    ${palette.dim(l)}`).join("\n")}${lines.length > 8 ? `\n    ${palette.dim(`... (${lines.length - 8} more lines)`)}` : ""}`
        : `  \u2717 ${truncate(msg, contentWidth())}`;
      return {
        state: flushed.state,
        output: [...flushed.output, `${palette.red(formatted)}\n`],
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
        const desc = detail.description ?? "";
        const short = desc.length > 60 ? `${desc.slice(0, 60)}\u2026` : desc;
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
            `  ${palette.cyan("\u23fb")} ${palette.yellow("compacting context\u2026")}\n`,
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

    case "history": {
      const flushed = flushActiveStream(state, palette);
      const output = [...flushed.output];
      const agent = event.agent;
      const label = agent ? palette.dim(`  [${agent} history]`) : palette.dim("  [history]");
      output.push(`${label}\n`);
      for (const msg of event.messages.slice(-6)) {
        const role = msg.role === "user" ? palette.cyan("you") : palette.dim("assistant");
        const preview = truncate(msg.content.replace(/\n/g, " "), contentWidth() - 14);
        output.push(`    ${role}: ${palette.dim(preview)}\n`);
      }
      if (event.messages.length > 6) {
        output.push(`    ${palette.dim(`... ${event.messages.length - 6} earlier messages`)}\n`);
      }
      return { state: flushed.state, output };
    }

    case "agent_entered":
    case "agent_exited":
    case "ready":
      return flushActiveStream(state, palette);

    case "todo": {
      const flushed = flushActiveStream(state, palette);
      const lines = event.todos.map((t) => {
        if (t.status === "completed") return `  ${palette.green("\u2713")} ${palette.dim(t.content)}`;
        if (t.status === "in_progress") return `  ${palette.cyan("\u25cf")} ${t.content}`;
        return `  ${palette.dim("\u25cb")} ${palette.dim(t.content)}`;
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
