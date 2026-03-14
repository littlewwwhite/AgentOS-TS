// input: stdin JSON commands or plain text, CLI args (workspace-path, --agents)
// output: stdout JSON events (piped) or ANSI-rendered terminal (TTY)
// pos: Local mode entry point — dispatches to REPL (TTY) or JSON protocol (piped)

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

// MUST delete before any SDK query() call — SDK uses this to detect nested
// Claude Code context, which breaks host-side execution.
delete process.env.CLAUDECODE;
// Avoid routing SDK calls through the host Claude Code's local proxy
if (process.env.ANTHROPIC_BASE_URL?.match(/^https?:\/\/(127\.0\.0\.1|localhost)/)) {
  delete process.env.ANTHROPIC_BASE_URL;
}

import { LocalOrchestrator } from "./local-orchestrator.js";
import { emit, parseCommand } from "./protocol.js";
import { loadEnvToProcess } from "./env.js";
import type { SandboxCommand, SandboxEvent } from "./protocol.js";
import { enableReplMode, handleSlashCommand, setPromptCallback } from "./repl/index.js";

// ---------- Global crash handlers ----------

process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[FATAL] uncaughtException: ${msg}\n`);
  emit({
    type: "error",
    message: `uncaughtException: ${err instanceof Error ? err.message : String(err)}`,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  process.stderr.write(`[FATAL] unhandledRejection: ${msg}\n`);
  emit({
    type: "error",
    message: `unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`,
  });
  process.exit(1);
});

// ---------- CLI args ----------

function parseArgs(argv: string[]): {
  projectPath: string;
  agentsDir: string;
  model?: string;
} {
  let agentsDir = "agents";
  let model: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--agents" && i + 1 < argv.length) agentsDir = argv[++i];
    else if (arg === "--model" && i + 1 < argv.length) model = argv[++i];
    else if (!arg.startsWith("-")) positional.push(arg);
  }

  return {
    projectPath: positional[0] ?? "workspace",
    agentsDir,
    model: model ?? process.env.AGENTOS_MODEL,
  };
}

// ---------- Command dispatch ----------

export async function handleLocalCommand(
  orchestrator: LocalOrchestrator,
  cmd: SandboxCommand,
): Promise<void> {
  switch (cmd.cmd) {
    case "chat": {
      const target = orchestrator.resolveTarget(cmd);
      await orchestrator.chat(cmd.message, target, cmd.request_id);
      break;
    }
    case "interrupt":
      orchestrator.interrupt(orchestrator.activeAgent);
      break;
    case "status": {
      const status = orchestrator.getStatus(orchestrator.activeAgent);
      emit({
        type: "status",
        state: status.busy ? "busy" : "idle",
        ...(status.sessionId ? { session_id: status.sessionId } : {}),
      } as SandboxEvent);
      break;
    }
    case "list_skills":
      emit({ type: "skills", skills: orchestrator.getSkillMap() });
      break;
    case "enter_agent":
      await orchestrator.enterAgent(cmd.agent);
      break;
    case "exit_agent":
      orchestrator.exitAgent();
      break;
    case "set_model":
      orchestrator.setModel(cmd.model);
      break;
    case "resume":
      await orchestrator.resumeSession(cmd.session_id);
      break;
  }
}

// ---------- stdin command loop ----------

const SLASH_COMMANDS = ["/new", "/status", "/agents", "/enter", "/exit", "/quit", "/help"];

/** Build a dynamic prompt showing the active agent context. */
function buildPrompt(orchestrator: LocalOrchestrator): string {
  if (!process.stdin.isTTY) return "";
  const agent = orchestrator.activeAgent;
  return agent ? `\x1b[36m${agent}\x1b[0m> ` : "\x1b[2m>\x1b[0m ";
}

/** Tab-completion: slash commands + agent names after `/enter `. */
function buildCompleter(orchestrator: LocalOrchestrator): (line: string) => [string[], string] {
  return (line: string): [string[], string] => {
    if (line.startsWith("/enter ")) {
      const partial = line.slice(7);
      const hits = orchestrator.agentNames.filter((n) => n.startsWith(partial));
      return [hits.map((n) => `/enter ${n}`), line];
    }
    if (line.startsWith("/")) {
      const hits = SLASH_COMMANDS.filter((c) => c.startsWith(line));
      return [hits, line];
    }
    return [[], line];
  };
}

function stdinLoop(orchestrator: LocalOrchestrator): Promise<void> {
  const isTTY = process.stdin.isTTY;

  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      // TTY mode: enable line editing, history, prompt, and tab completion
      ...(isTTY
        ? {
            output: process.stdout,
            terminal: true,
            prompt: buildPrompt(orchestrator),
            completer: buildCompleter(orchestrator),
          }
        : { terminal: false }),
    });

    // Ctrl+C: interrupt running query; double-press while idle to exit
    if (isTTY) {
      let lastSigint = 0;
      rl.on("SIGINT", () => {
        const status = orchestrator.getStatus(orchestrator.activeAgent);
        if (status.busy) {
          orchestrator.interrupt(orchestrator.activeAgent);
          process.stdout.write("\n\x1b[33m  interrupted\x1b[0m\n");
          lastSigint = 0;
        } else {
          const now = Date.now();
          if (now - lastSigint < 500) {
            process.stdout.write("\n");
            rl.close();
            return;
          }
          lastSigint = now;
          process.stdout.write("\n\x1b[2m  press Ctrl+C again to exit\x1b[0m\n");
        }
        rl.setPrompt(buildPrompt(orchestrator));
        rl.prompt();
      });
    }

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        if (isTTY) { rl.setPrompt(buildPrompt(orchestrator)); rl.prompt(); }
        return;
      }

      // Slash commands (TTY only)
      if (trimmed.startsWith("/") && handleSlashCommand(trimmed, orchestrator)) {
        if (isTTY) { rl.setPrompt(buildPrompt(orchestrator)); rl.prompt(); }
        return;
      }

      // Try structured JSON command first; fall back to plain-text chat
      const cmd = parseCommand(trimmed) ?? { cmd: "chat" as const, message: trimmed };
      handleLocalCommand(orchestrator, cmd).catch((err) => {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    });

    rl.on("close", resolve);

    // Wire prompt re-display: REPL emitter calls this after result/error events
    if (isTTY) {
      setPromptCallback(() => {
        rl.setPrompt(buildPrompt(orchestrator));
        rl.prompt();
      });
      rl.prompt();
    }
  });
}

// ---------- main ----------

async function main(): Promise<void> {
  loadEnvToProcess(path.resolve(".env"));

  const { projectPath: rawPath, agentsDir, model } = parseArgs(process.argv.slice(2));

  const isTTY = !!process.stdin.isTTY;

  // TTY → human-readable rendering; piped → raw JSON protocol
  if (isTTY) enableReplMode();
  const projectPath = path.resolve(rawPath);
  await fs.mkdir(projectPath, { recursive: true });

  const orchestrator = new LocalOrchestrator({
    projectPath,
    agentsDir,
    model,
    freshStart: isTTY, // REPL starts clean; piped mode restores sessions
  });
  await orchestrator.init();

  // Heartbeat keeps the stdout stream alive for any transport layer that
  // monitors idle connections (reverse proxies, process supervisors, etc.)
  const heartbeat = setInterval(() => {
    emit({ type: "heartbeat", ts: Date.now() } as SandboxEvent);
  }, 30_000);
  if (heartbeat.unref) heartbeat.unref();

  await Promise.race([stdinLoop(orchestrator), orchestrator.startWorkers()]);
}

main().catch((err) => {
  emit({
    type: "error",
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
