#!/usr/bin/env bun
// input: --project <workspace name> --prompt-file <path> [--resume <session_id>] [--max-turns N]
// output: stream agent events as JSON-lines to stdout, loop on result events until DONE
// pos: nohup-friendly headless variant of orchestrator.ts, survives SDK turn boundaries
//      via a yieldable input queue + pipeline-state.json driven continue-turn logic

import { query, type SDKUserMessage, type Query } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_MAX_TURNS = 60;
const STUCK_LIMIT = 3;
const CONTINUE_PROMPT = [
  "上一轮 SDK turn 已结束但 pipeline 未到达 DONE。",
  "请读取 pipeline-state.json 与已生成的 artifacts，识别 current_stage 与 next_action，",
  "按照 CLAUDE.md 的工作流继续推进到下一个未完成的 stage / episode。",
  "成功完成或写入新产物后，及时更新 pipeline-state.json。",
  "只有当 current_stage == \"DONE\" 或发生明确的不可恢复错误时才停止。",
].join("\n");

interface Args {
  project: string;
  promptFile: string;
  resume?: string;
  maxTurns: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let project: string | undefined;
  let promptFile: string | undefined;
  let resume: string | undefined;
  let maxTurns = DEFAULT_MAX_TURNS;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") project = argv[++i];
    else if (a === "--prompt-file") promptFile = argv[++i];
    else if (a === "--resume") resume = argv[++i];
    else if (a === "--max-turns") maxTurns = Math.max(1, Number(argv[++i]) || DEFAULT_MAX_TURNS);
  }
  if (!project || !promptFile) {
    console.error(
      "usage: bun apps/console/headless.ts --project <name> --prompt-file <path> [--resume <session_id>] [--max-turns N]",
    );
    process.exit(2);
  }
  return { project, promptFile, resume, maxTurns };
}

function emit(record: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n");
}

class InputQueue implements AsyncIterableIterator<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private waiters: ((v: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: msg, done: false });
    else this.queue.push(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w({ value: undefined as unknown as SDKUserMessage, done: true });
    }
  }

  next(): Promise<IteratorResult<SDKUserMessage>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift()!, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<SDKUserMessage> {
    return this;
  }
}

interface StateSnapshot {
  current_stage: string | null;
  signature: string;
}

function readStateSnapshot(stateFile: string): StateSnapshot | null {
  if (!existsSync(stateFile)) return null;
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cs = typeof parsed.current_stage === "string" ? parsed.current_stage : null;
    return { current_stage: cs, signature: raw };
  } catch (err) {
    emit({ type: "state_read_error", message: String(err) });
    return null;
  }
}

function buildUserMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

async function main() {
  const { project, promptFile, resume, maxTurns } = parseArgs();
  const cwd = join(PROJECT_ROOT, "workspace", project);
  const stateFile = join(cwd, "pipeline-state.json");
  const promptText = readFileSync(promptFile, "utf-8");

  emit({ type: "headless_start", project, cwd, promptFile, resume: resume ?? null, maxTurns });

  const inputQueue = new InputQueue();
  inputQueue.push(buildUserMessage(promptText));

  const sdkQuery: Query = query({
    prompt: inputQueue,
    options: {
      cwd,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: false,
      settingSources: ["project", "local"],
      thinking: { type: "adaptive" },
      settings: {
        showThinkingSummaries: false,
        alwaysThinkingEnabled: true,
      },
      ...(resume ? { resume } : {}),
    },
  });

  let sessionId: string | null = null;
  let turnCount = 0;
  let stuckCount = 0;
  let lastSignature: string | null = null;

  try {
    for await (const msg of sdkQuery) {
      const t = (msg as { type?: string }).type;

      if (t === "system") {
        const sys = msg as { subtype?: string; session_id?: string };
        if (sys.subtype === "init" && sys.session_id) {
          sessionId = sys.session_id;
          emit({ type: "session", sessionId });
        }
        continue;
      }

      if (t === "assistant") {
        const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
        for (const block of content as Array<{
          type: string;
          text?: string;
          name?: string;
          input?: unknown;
          id?: string;
        }>) {
          if (block.type === "text" && block.text) {
            emit({ type: "text", text: block.text });
          }
          if (block.type === "tool_use") {
            emit({ type: "tool_use", tool: block.name ?? "", input: block.input, id: block.id });
          }
        }
        continue;
      }

      if (t === "user") {
        const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
        for (const block of content as Array<{ type: string; tool_use_id?: string; content?: unknown }>) {
          if (block.type === "tool_result") {
            const out = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
            const head = out.length > 800 ? out.slice(0, 800) + `…[+${out.length - 800} chars]` : out;
            emit({ type: "tool_result", id: block.tool_use_id ?? "", output: head });
          }
        }
        continue;
      }

      if (t === "result") {
        const r = msg as { subtype?: string; duration_ms?: number; is_error?: boolean; result?: string };
        const ok = r.subtype === "success" && r.is_error !== true;
        turnCount += 1;
        emit({
          type: "result",
          ok,
          turn: turnCount,
          durationMs: r.duration_ms ?? 0,
          summary: r.result ?? null,
        });

        const snap = readStateSnapshot(stateFile);
        const stage = snap?.current_stage ?? "<unknown>";
        emit({ type: "turn_state", stage, turn: turnCount });

        if (snap?.current_stage === "DONE") {
          emit({ type: "headless_end", reason: "done", sessionId });
          inputQueue.close();
          process.exit(ok ? 0 : 1);
        }

        if (turnCount >= maxTurns) {
          emit({ type: "headless_end", reason: "max_turns_reached", maxTurns, sessionId });
          inputQueue.close();
          process.exit(ok ? 0 : 1);
        }

        if (snap && lastSignature !== null && snap.signature === lastSignature) {
          stuckCount += 1;
        } else {
          stuckCount = 0;
        }
        lastSignature = snap?.signature ?? lastSignature;

        if (stuckCount >= STUCK_LIMIT) {
          emit({
            type: "headless_end",
            reason: "stuck_no_state_change",
            stuckCount,
            sessionId,
          });
          inputQueue.close();
          process.exit(2);
        }

        emit({ type: "continue_turn", turn: turnCount, stage });
        inputQueue.push(buildUserMessage(CONTINUE_PROMPT));
        continue;
      }
    }
  } catch (err) {
    emit({ type: "error", message: String(err) });
    inputQueue.close();
    process.exit(1);
  }

  emit({ type: "headless_end_unexpected", sessionId });
  process.exit(2);
}

main().catch((err) => {
  emit({ type: "fatal", message: String(err) });
  process.exit(1);
});
