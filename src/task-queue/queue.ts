// input: Task submissions from MCP tools, poll triggers from internal loop
// output: Task lifecycle management (submit → poll → complete/fail)
// pos: Core engine — orchestrates task execution with concurrency control and retry

import path from "node:path";

import { createExecutor, type PollResult, type TaskExecutor } from "./executor.js";
import { ApiRegistry, type ApiConfig } from "./registry.js";
import { TaskQueueStore, type CreateTaskInput, type TaskRecord, type TaskStatus } from "./store.js";

export interface TaskQueueOptions {
  store: TaskQueueStore;
  registry: ApiRegistry;
  pollIntervalMs?: number;
}

interface ActivePoll {
  taskId: string;
  externalId: string;
  executor: TaskExecutor;
  config: ApiConfig;
  timer: ReturnType<typeof setTimeout> | null;
}

export class TaskQueue {
  private store: TaskQueueStore;
  private registry: ApiRegistry;
  private activePolls = new Map<string, ActivePoll>();
  private providerConcurrency = new Map<string, number>();
  private stopped = false;

  constructor(options: TaskQueueOptions) {
    this.store = options.store;
    this.registry = options.registry;
  }

  /**
   * Submit a new task. Writes to DB and immediately attempts to start execution.
   */
  async submit(input: CreateTaskInput): Promise<TaskRecord> {
    const config = this.registry.get(input.type);
    if (!config) {
      throw new Error(`Unknown task type: ${input.type}. Available: ${this.registry.list().map((c) => c.name).join(", ")}`);
    }

    const task = this.store.create(input);
    // Fire-and-forget: attempt to start execution
    this.tryExecute(task, config);
    return task;
  }

  /**
   * Batch query task statuses.
   */
  getStatus(taskIds: string[]): TaskRecord[] {
    return this.store.getMany(taskIds);
  }

  /**
   * Cancel a task. Stops polling if active.
   */
  cancel(taskId: string): boolean {
    const poll = this.activePolls.get(taskId);
    if (poll?.timer) {
      clearTimeout(poll.timer);
      this.activePolls.delete(taskId);
      this.decrementConcurrency(poll.config.name);
    }
    return this.store.cancel(taskId);
  }

  /**
   * Download result artifacts for a completed task.
   */
  async downloadResult(taskId: string, destPath: string): Promise<string[]> {
    const task = this.store.getById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status !== "completed") {
      throw new Error(`Task ${taskId} is not completed (status: ${task.status})`);
    }
    if (!task.result) {
      throw new Error(`Task ${taskId} has no result data`);
    }

    const config = this.registry.get(task.type);
    if (!config) throw new Error(`Unknown task type: ${task.type}`);

    const executor = createExecutor(config);
    return executor.download(task.result, destPath);
  }

  /**
   * Resume polling for any in-flight tasks after restart.
   */
  resumeInFlight(): void {
    const inFlight = this.store.listByStatus("submitted", "processing");
    for (const task of inFlight) {
      if (!task.externalId) continue;
      const config = this.registry.get(task.type);
      if (!config) continue;
      this.startPolling(task, config);
    }

    // Also attempt to execute any pending tasks
    const pending = this.store.listByStatus("pending");
    for (const task of pending) {
      const config = this.registry.get(task.type);
      if (!config) continue;
      this.tryExecute(task, config);
    }
  }

  /**
   * Stop all polling and cleanup.
   */
  stop(): void {
    this.stopped = true;
    for (const poll of this.activePolls.values()) {
      if (poll.timer) clearTimeout(poll.timer);
    }
    this.activePolls.clear();
    this.providerConcurrency.clear();
  }

  // -- Internal --

  private async tryExecute(task: TaskRecord, config: ApiConfig): Promise<void> {
    if (this.stopped) return;

    // Check concurrency limit
    const current = this.providerConcurrency.get(config.name) ?? 0;
    if (current >= config.rateLimit.maxConcurrent) {
      // Will be picked up by resumeInFlight or next submit
      return;
    }

    this.incrementConcurrency(config.name);
    const executor = createExecutor(config);

    try {
      // Apply rate-limit delay
      if (config.rateLimit.delayMs > 0) {
        await new Promise((r) => setTimeout(r, config.rateLimit.delayMs));
      }
      if (this.stopped) return;

      const externalId = await executor.submit(task.params);
      if (this.stopped) return;

      this.store.updateStatus(task.id, {
        status: "submitted",
        externalId,
        attempt: task.attempt + 1,
      });

      const updated = this.store.getById(task.id)!;
      this.startPolling(updated, config);
    } catch (err) {
      if (this.stopped) return;

      const attempt = task.attempt + 1;
      if (attempt < task.maxAttempts) {
        // Retry: keep as pending, increment attempt
        this.store.updateStatus(task.id, { status: "pending", attempt });
        this.decrementConcurrency(config.name);
        // Schedule retry with exponential backoff
        const backoffMs = Math.min(config.rateLimit.delayMs * 2 ** attempt, 30_000);
        setTimeout(() => {
          if (this.stopped) return;
          const retryTask = this.store.getById(task.id);
          if (retryTask?.status === "pending") {
            this.tryExecute(retryTask, config);
          }
        }, backoffMs);
      } else {
        this.store.updateStatus(task.id, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          attempt,
        });
        this.decrementConcurrency(config.name);
      }
    }
  }

  private startPolling(task: TaskRecord, config: ApiConfig): void {
    if (this.stopped || !task.externalId) return;
    if (this.activePolls.has(task.id)) return;

    const executor = createExecutor(config);
    const poll: ActivePoll = {
      taskId: task.id,
      externalId: task.externalId,
      executor,
      config,
      timer: null,
    };

    this.activePolls.set(task.id, poll);
    this.schedulePoll(poll, config.polling.intervalMs);
  }

  private schedulePoll(poll: ActivePoll, intervalMs: number): void {
    poll.timer = setTimeout(async () => {
      if (this.stopped) return;

      try {
        const result = await poll.executor.poll(poll.externalId);
        this.handlePollResult(poll, result);
      } catch (err) {
        if (this.stopped) return;
        // Transient poll error — retry with backoff
        const nextInterval = Math.min(intervalMs * 1.5, poll.config.polling.maxWaitMs);
        this.schedulePoll(poll, nextInterval);
      }
    }, intervalMs);
  }

  private handlePollResult(poll: ActivePoll, result: PollResult): void {
    if (this.stopped) return;
    const { taskId, config } = poll;

    if (result.status === "completed") {
      this.store.updateStatus(taskId, {
        status: "completed",
        result: result.result ?? {},
      });
      this.finishPoll(poll);
    } else if (result.status === "failed") {
      const task = this.store.getById(taskId);
      if (task && task.attempt < task.maxAttempts) {
        // Retry submission
        this.store.updateStatus(taskId, {
          status: "pending",
          error: result.error,
        });
        this.finishPoll(poll);
        const retryTask = this.store.getById(taskId)!;
        this.tryExecute(retryTask, config);
      } else {
        this.store.updateStatus(taskId, {
          status: "failed",
          error: result.error,
        });
        this.finishPoll(poll);
      }
    } else {
      // Still pending/processing — update status and continue polling
      const newStatus: TaskStatus =
        result.status === "processing" ? "processing" : "submitted";
      this.store.updateStatus(taskId, { status: newStatus });
      this.schedulePoll(poll, config.polling.intervalMs);
    }
  }

  private finishPoll(poll: ActivePoll): void {
    if (poll.timer) clearTimeout(poll.timer);
    this.activePolls.delete(poll.taskId);
    this.decrementConcurrency(poll.config.name);

    // Try to start next pending task for this provider
    if (!this.stopped) {
      const pending = this.store.listByStatus("pending");
      for (const task of pending) {
        if (task.type === poll.config.name) {
          this.tryExecute(task, poll.config);
          break;
        }
      }
    }
  }

  private incrementConcurrency(provider: string): void {
    this.providerConcurrency.set(
      provider,
      (this.providerConcurrency.get(provider) ?? 0) + 1,
    );
  }

  private decrementConcurrency(provider: string): void {
    const current = this.providerConcurrency.get(provider) ?? 0;
    this.providerConcurrency.set(provider, Math.max(0, current - 1));
  }
}
