// input: Protocol events, orchestrator commands
// output: ANSI terminal rendering, slash command routing
// pos: REPL module barrel — aggregates TUI layer for interactive terminal mode

import { setEmitter } from "../protocol.js";
import { emit } from "../protocol.js";
import type { SandboxEvent } from "../protocol.js";
import type { LocalOrchestrator } from "../local-orchestrator.js";
import { createInitialReplState, applyReplEvent } from "./state.js";
import { renderSandboxEvent, type ReplPalette } from "./render.js";
import { TerminalSpinner } from "./spinner.js";

// ---------- ANSI palette ----------

export const ANSI_PALETTE: ReplPalette = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  magenta: (s) => `\x1b[35m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  badge: (name) => `\x1b[48;5;236m\x1b[37m ${name} \x1b[0m`,
};

// ---------- Prompt callback ----------

/** Called by the emitter after terminal events (result, error) to re-display the input prompt. */
let promptCallback: (() => void) | null = null;

/** Register a callback that re-displays the readline prompt after agent output completes. */
export function setPromptCallback(fn: () => void): void {
  promptCallback = fn;
}

// ---------- Helpers ----------

function formatChars(n: number): string {
  if (n < 1000) return `${n} chars`;
  return `${(n / 1000).toFixed(1)}k chars`;
}

// ---------- Enable REPL rendering ----------

/** Replace the default JSON-line emitter with a human-readable ANSI renderer. */
export function enableReplMode(): void {
  let replState = createInitialReplState();
  const spinner = new TerminalSpinner(process.stdout, ANSI_PALETTE.dim);
  const write = (s: string) => { process.stdout.write(s); };

  setEmitter((event: SandboxEvent) => {
    // State transitions (agent enter/exit logging)
    const stateResult = applyReplEvent(replState, event);
    replState = stateResult.state;
    for (const log of stateResult.logs) {
      spinner.guardedWrite(`${ANSI_PALETTE.magenta(log)}\n`);
    }

    // Suppress in TTY
    if (event.type === "heartbeat") return;

    // System init — start spinner (shown until first thinking/text arrives)
    if (event.type === "system" && event.subtype === "init") {
      spinner.start(ANSI_PALETTE.dim("thinking..."));
      return;
    }

    // Ready event — show banner
    if (event.type === "ready") {
      write(
        `${ANSI_PALETTE.bold("AgentOS")} ${ANSI_PALETTE.dim("ready")} | agents: ${event.skills.map(ANSI_PALETTE.cyan).join(", ")}\n`,
      );
      return;
    }

    // --- Thinking: collapsed rendering via spinner ---
    if (event.type === "thinking") {
      // Update state (accumulate chars) without producing output
      const rendered = renderSandboxEvent(replState, event, ANSI_PALETTE);
      replState = rendered.state;
      // Show/update spinner with progress
      const chars = replState.thinking?.chars ?? 0;
      const label = ANSI_PALETTE.dim(`thinking... (${formatChars(chars)})`);
      if (spinner.isActive) {
        spinner.update(label);
      } else {
        spinner.start(label);
      }
      return;
    }

    // --- Non-thinking event: finalize thinking if it was active ---
    if (replState.thinking) {
      if (spinner.isActive) spinner.stop();
      const t = replState.thinking;
      const elapsed = ((Date.now() - t.startedAt) / 1000).toFixed(1);
      write(`${ANSI_PALETTE.dim(`  \u25B8 thinking (${formatChars(t.chars)}, ${elapsed}s)`)}\n`);
      replState = { ...replState, thinking: null, activeStream: null };
    }

    // Any renderable event — stop spinner, write directly
    if (spinner.isActive) spinner.stop();

    const rendered = renderSandboxEvent(replState, event, ANSI_PALETTE);
    replState = rendered.state;
    for (const part of rendered.output) {
      write(part);
    }

    // Re-display prompt after terminal events (query finished or errored out)
    if (event.type === "result" || event.type === "error") {
      promptCallback?.();
    }
  });
}

// ---------- Slash commands ----------

const HELP_TEXT = [
  "",
  "  /new          Clear session, start fresh",
  "  /status       Show current session info",
  "  /agents       List available agents",
  "  /enter <name> Switch to agent",
  "  /exit         Return to main",
  "  /help         Show this help",
  "",
].join("\n");

/** Handle interactive slash commands. Returns true if input was consumed. */
export function handleSlashCommand(input: string, orchestrator: LocalOrchestrator): boolean {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  switch (cmd) {
    case "new":
      orchestrator.resetSessions();
      emit({ type: "system", subtype: "session_reset", detail: {} } as SandboxEvent);
      process.stdout.write(`${ANSI_PALETTE.green("  Session cleared. Starting fresh.")}\n`);
      return true;

    case "status": {
      const status = orchestrator.getStatus(orchestrator.activeAgent);
      const agent = orchestrator.activeAgent ?? "main";
      const stateColor = status.busy ? ANSI_PALETTE.yellow : ANSI_PALETTE.green;
      process.stdout.write(
        `  agent: ${ANSI_PALETTE.cyan(agent)} | ${stateColor(status.busy ? "busy" : "idle")} | session: ${ANSI_PALETTE.dim(status.sessionId ?? "(none)")}\n`,
      );
      return true;
    }

    case "agents":
      process.stdout.write(`  ${ANSI_PALETTE.dim("Available:")} ${orchestrator.agentNames.map(ANSI_PALETTE.cyan).join(", ")}\n`);
      return true;

    case "enter": {
      const target = parts[1];
      if (!target) {
        process.stdout.write(`  ${ANSI_PALETTE.dim("Usage:")} /enter <agent-name>\n`);
        return true;
      }
      orchestrator.enterAgent(target).catch(() => {});
      return true;
    }

    case "exit":
      orchestrator.exitAgent();
      return true;

    case "help":
      process.stdout.write(HELP_TEXT);
      return true;

    default:
      return false;
  }
}
