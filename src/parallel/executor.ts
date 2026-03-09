// input: WorkerTaskConfig[], option factory function
// output: ParallelExecutionSummary with per-task results
// pos: @planned — Concurrency engine — runs isolated SDK sessions in parallel with semaphore control

import fs from "node:fs/promises";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import {
  defaultParallelOptions,
  type ParallelExecutionOptions,
  type WorkerTaskConfig,
} from "./config.js";

export interface WorkerResult {
  taskId: string;
  status: "success" | "failed" | "timeout";
  output: string;
  error?: string;
  durationMs?: number;
  totalCostUsd?: number;
  sessionId?: string;
}

export interface ParallelExecutionSummary {
  tasks: WorkerResult[];
  totalDurationMs: number;
  totalCostUsd: number;
  successCount: number;
  failedCount: number;
}

type OptionFactory = (task: WorkerTaskConfig) => Record<string, unknown>;

export function defaultOptionFactory(task: WorkerTaskConfig): Record<string, unknown> {
  return {
    cwd: path.resolve(task.workdir),
    permissionMode: "acceptEdits",
    settingSources: ["project"],
    includePartialMessages: true,
    maxBudgetUsd: task.maxBudgetUsd ?? 5.0,
    env: task.env ?? {},
    model: task.model,
  };
}

// Simple semaphore using a queue of resolve callbacks
class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.current--;
    }
  }
}

async function loadPrompt(task: WorkerTaskConfig): Promise<string> {
  if (task.promptFile) {
    const filePath = path.join(task.workdir, task.promptFile);
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      // Fall through to direct prompt
    }
  }
  return task.prompt;
}

async function runSingleTask(
  task: WorkerTaskConfig,
  optionFactory: OptionFactory,
  timeoutMs: number,
): Promise<WorkerResult> {
  const start = Date.now();
  const options = optionFactory(task);
  const prompt = await loadPrompt(task);

  try {
    const chunks: string[] = [];
    let sessionId: string | undefined;
    let totalCostUsd: number | undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      for await (const message of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
        if (controller.signal.aborted) break;

        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "text" && block.text) {
              chunks.push(block.text);
            }
          }
        } else if (message.type === "result") {
          const result = message as Record<string, unknown>;
          sessionId = (result.session_id as string) ?? undefined;
          totalCostUsd = (result.total_cost_usd as number) ?? undefined;
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (controller.signal.aborted) {
      return {
        taskId: task.taskId,
        status: "timeout",
        output: chunks.join(""),
        error: `Timeout after ${timeoutMs}ms`,
        durationMs: Date.now() - start,
      };
    }

    return {
      taskId: task.taskId,
      status: "success",
      output: chunks.join("").trim(),
      durationMs: Date.now() - start,
      totalCostUsd,
      sessionId,
    };
  } catch (err) {
    return {
      taskId: task.taskId,
      status: "failed",
      output: "",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

export async function executeParallel(
  tasks: WorkerTaskConfig[],
  optionFactory: OptionFactory = defaultOptionFactory,
  options: Partial<ParallelExecutionOptions> = {},
): Promise<ParallelExecutionSummary> {
  const opts = { ...defaultParallelOptions, ...options };
  const start = Date.now();
  const semaphore = new Semaphore(opts.maxConcurrent);

  async function runWithSemaphore(task: WorkerTaskConfig): Promise<WorkerResult> {
    await semaphore.acquire();
    try {
      return await runSingleTask(task, optionFactory, opts.timeoutMs);
    } finally {
      semaphore.release();
    }
  }

  let results: WorkerResult[];

  if (opts.failFast) {
    // Race all tasks; if any fails, we still collect what completed
    results = await Promise.all(tasks.map(runWithSemaphore));
  } else {
    const settled = await Promise.allSettled(tasks.map(runWithSemaphore));
    results = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : {
            taskId: tasks[i].taskId,
            status: "failed" as const,
            output: "",
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
            durationMs: Date.now() - start,
          },
    );
  }

  return {
    tasks: results,
    totalDurationMs: Date.now() - start,
    totalCostUsd: results.reduce((sum, r) => sum + (r.totalCostUsd ?? 0), 0),
    successCount: results.filter((r) => r.status === "success").length,
    failedCount: results.filter((r) => r.status !== "success").length,
  };
}
