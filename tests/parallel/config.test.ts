import { describe, expect, it } from "vitest";
import type { WorkerTaskConfig, ParallelExecutionOptions } from "../../src/parallel/config.js";
import { defaultParallelOptions } from "../../src/parallel/config.js";

describe("parallel config", () => {
  it("has sensible defaults", () => {
    expect(defaultParallelOptions.maxConcurrent).toBe(3);
    expect(defaultParallelOptions.timeoutMs).toBe(300_000);
    expect(defaultParallelOptions.failFast).toBe(true);
  });

  it("WorkerTaskConfig can be constructed", () => {
    const task: WorkerTaskConfig = {
      taskId: "test-001",
      prompt: "Do something",
      workdir: "/tmp/test",
    };
    expect(task.taskId).toBe("test-001");
    expect(task.prompt).toBe("Do something");
    expect(task.maxBudgetUsd).toBeUndefined();
  });

  it("ParallelExecutionOptions can be partially overridden", () => {
    const opts: ParallelExecutionOptions = {
      ...defaultParallelOptions,
      maxConcurrent: 5,
    };
    expect(opts.maxConcurrent).toBe(5);
    expect(opts.failFast).toBe(true); // from defaults
  });
});
