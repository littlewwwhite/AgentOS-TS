// input: stdin JSON commands, CLI args (workspace-path, --agents)
// output: stdout JSON events via protocol (same wire format as sandbox.ts)
// pos: Local mode entry point — runs agents directly on host without E2B sandbox

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

// ---------- Resume helper ----------

type ResumableSession = {
  sessionId: string | null;
  historyLoaded: boolean;
  options: Record<string, unknown>;
};

type ResumeInternals = {
  mainSession: ResumableSession | null;
  emitHistoryForSession(session: ResumableSession): Promise<void>;
  saveSessions(): void;
};

async function resumeMainSession(
  orchestrator: LocalOrchestrator,
  sessionId: string,
): Promise<void> {
  const internals = orchestrator as unknown as ResumeInternals;
  const session = internals.mainSession;

  if (!session) {
    emit({ type: "error", message: "No main session available to resume" });
    return;
  }

  session.sessionId = sessionId;
  session.options.resume = sessionId;
  session.options.continue = false;
  session.historyLoaded = false;

  internals.saveSessions();
  await internals.emitHistoryForSession(session);

  const status = orchestrator.getStatus(null);
  emit({
    type: "status",
    state: status.busy ? "busy" : "idle",
    session_id: sessionId,
  });
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
      await resumeMainSession(orchestrator, cmd.session_id);
      break;
  }
}

// ---------- stdin command loop ----------

function stdinLoop(orchestrator: LocalOrchestrator): Promise<void> {
  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on("line", (line) => {
      const cmd = parseCommand(line);
      if (!cmd) return;
      handleLocalCommand(orchestrator, cmd).catch(() => {});
    });

    rl.on("close", resolve);
  });
}

// ---------- main ----------

async function main(): Promise<void> {
  loadEnvToProcess(path.resolve(".env"));

  const { projectPath: rawPath, agentsDir, model } = parseArgs(process.argv.slice(2));
  const projectPath = path.resolve(rawPath);
  await fs.mkdir(projectPath, { recursive: true });

  const orchestrator = new LocalOrchestrator({
    projectPath,
    agentsDir,
    model,
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
