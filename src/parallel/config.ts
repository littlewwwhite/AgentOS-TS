// input: Task definitions with prompt, workdir, budget
// output: WorkerTaskConfig and ParallelExecutionOptions types
// pos: Contracts — configuration for parallel task execution

export interface WorkerTaskConfig {
  taskId: string;
  agent?: string;
  prompt: string;
  workdir: string;
  promptFile?: string;
  env?: Record<string, string>;
  model?: string;
  maxBudgetUsd?: number;
}

export interface ParallelExecutionOptions {
  maxConcurrent: number;
  timeoutMs: number;
  failFast: boolean;
}

export const defaultParallelOptions: ParallelExecutionOptions = {
  maxConcurrent: 3,
  timeoutMs: 300_000,
  failFast: true,
};
