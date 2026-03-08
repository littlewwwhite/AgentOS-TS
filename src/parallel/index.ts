// input: Parallel execution modules
// output: Public API for parallel task execution
// pos: Module boundary — re-exports config and executor

export type { WorkerTaskConfig, ParallelExecutionOptions } from "./config.js";
export { defaultParallelOptions } from "./config.js";

export type { WorkerResult, ParallelExecutionSummary } from "./executor.js";
export { executeParallel, defaultOptionFactory } from "./executor.js";
