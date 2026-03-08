// input: stdin JSON commands, CLI args (project path, skills dir)
// output: stdout JSON events via protocol
// pos: Sandbox entry point — replaces REPL with JSON protocol, reuses buildOptions()

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildOptions } from "./orchestrator.js";
import { emit, parseCommand } from "./protocol.js";
import type { SandboxEvent } from "./protocol.js";

// ---------- .env loader (inline, same as index.ts) ----------

async function loadEnvFile(filePath: string): Promise<void> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------- CLI args ----------

function parseArgs(argv: string[]): {
  projectPath: string;
  skillsDir: string;
  model?: string;
} {
  let skillsDir = "skills";
  let model: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skills" && i + 1 < argv.length) skillsDir = argv[++i];
    else if (arg === "--model" && i + 1 < argv.length) model = argv[++i];
    else if (!arg.startsWith("-")) positional.push(arg);
  }

  return {
    projectPath: positional[0] ?? "workspace",
    skillsDir,
    model: model ?? process.env.AGENTOS_MODEL,
  };
}

// ---------- Async Queue ----------

class AsyncQueue<T> {
  private waiters: Array<(value: T) => void> = [];
  private buffer: T[] = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.buffer.push(item);
    }
  }

  pull(): Promise<T> {
    const item = this.buffer.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise<T>((resolve) => this.waiters.push(resolve));
  }
}

// ---------- State ----------

interface SandboxState {
  busy: boolean;
  activeQuery: Query | null;
  sessionId: string | null;
  skillMap: Record<string, string>;
}

// ---------- Process a single query ----------

async function processQuery(
  prompt: string,
  options: Record<string, unknown>,
  state: SandboxState,
): Promise<void> {
  const t0 = Date.now();
  const q = query({ prompt, options });
  state.activeQuery = q;

  try {
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === "assistant") {
        for (const b of msg.message.content) {
          if (b.type === "text" && b.text) {
            emit({ type: "text", text: b.text });
          }
        }
      } else if (msg.type === "stream_event") {
        const ev = msg.event as {
          type?: string;
          delta?: { type?: string; text?: string };
        };
        if (
          ev.type === "content_block_delta" &&
          ev.delta?.type === "text_delta" &&
          ev.delta.text
        ) {
          emit({ type: "text", text: ev.delta.text });
        }
      } else if (msg.type === "tool_progress") {
        const tp = msg as unknown as {
          tool_name?: string;
          tool_use_id?: string;
        };
        emit({
          type: "tool_use",
          tool: tp.tool_name ?? "unknown",
          id: tp.tool_use_id ?? "",
        });
      } else if (msg.type === "result") {
        const r = msg as unknown as {
          total_cost_usd?: number;
          is_error?: boolean;
          duration_ms?: number;
          session_id?: string;
        };
        const sessionId = r.session_id ?? state.sessionId ?? "";
        if (r.session_id) {
          state.sessionId = r.session_id;
          // Update options for session resume on next query
          (options as Record<string, unknown>).resume = r.session_id;
          (options as Record<string, unknown>).continueConversation = false;
        }
        emit({
          type: "result",
          cost: r.total_cost_usd ?? 0,
          duration_ms: r.duration_ms ?? Date.now() - t0,
          session_id: sessionId,
          is_error: r.is_error ?? false,
        });
      }
    }
  } finally {
    state.activeQuery = null;
  }
}

// ---------- stdin loop ----------

function stdinLoop(
  chatQueue: AsyncQueue<string>,
  state: SandboxState,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on("line", (line) => {
      const cmd = parseCommand(line);
      if (!cmd) return;

      switch (cmd.cmd) {
        case "chat":
          chatQueue.push(cmd.message);
          break;
        case "interrupt":
          if (state.activeQuery) {
            state.activeQuery.close();
            state.activeQuery = null;
          }
          break;
        case "status":
          emit({
            type: "status",
            state: state.busy ? "busy" : "idle",
            ...(state.sessionId ? { session_id: state.sessionId } : {}),
          } as SandboxEvent);
          break;
        case "list_skills":
          emit({ type: "skills", skills: state.skillMap });
          break;
      }
    });

    rl.on("close", resolve);
  });
}

// ---------- Worker loop ----------

async function workerLoop(
  chatQueue: AsyncQueue<string>,
  options: Record<string, unknown>,
  state: SandboxState,
): Promise<void> {
  // Worker runs forever until process exits; driven by chatQueue
  while (true) {
    const prompt = await chatQueue.pull();
    state.busy = true;
    try {
      await processQuery(prompt, options, state);
    } catch (err) {
      emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      state.busy = false;
    }
  }
}

// ---------- main ----------

async function main(): Promise<void> {
  await loadEnvFile(path.resolve(".env"));

  const { projectPath: rawPath, skillsDir, model } = parseArgs(
    process.argv.slice(2),
  );
  const projectPath = path.resolve(rawPath);
  await fs.mkdir(projectPath, { recursive: true });

  const options = (await buildOptions(
    projectPath,
    skillsDir,
    model,
  )) as Record<string, unknown>;

  const agents = (options.agents ?? {}) as Record<
    string,
    { description: string }
  >;
  const skillMap: Record<string, string> = {};
  for (const [name, defn] of Object.entries(agents)) {
    skillMap[name] = defn.description;
  }

  const state: SandboxState = {
    busy: false,
    activeQuery: null,
    sessionId: null,
    skillMap,
  };

  emit({ type: "ready", skills: Object.keys(agents) });

  const chatQueue = new AsyncQueue<string>();

  // stdin close → process exits; worker runs until then
  await Promise.race([
    stdinLoop(chatQueue, state),
    workerLoop(chatQueue, options, state),
  ]);
}

main().catch((err) => {
  emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
