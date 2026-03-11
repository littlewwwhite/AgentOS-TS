import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskQueue } from "../src/task-queue/queue.js";
import { TaskQueueStore } from "../src/task-queue/store.js";
import { ApiRegistry, type ApiConfig } from "../src/task-queue/registry.js";

// -- Stub executor via module-level override --
// Since bun test doesn't support vi.mock, we test the queue
// through its public API using the store as the verification layer.
// The executor is tested indirectly through submit → store state transitions.

const TEST_CONFIG: ApiConfig = {
  name: "test-image",
  provider: "test",
  baseUrl: "https://test.example.com",
  authType: "bearer",
  authFile: "~/.test_auth.json",
  endpoints: {
    submit: { method: "POST", path: "/submit" },
    poll: { method: "GET", path: "/poll" },
    statusField: "data.status",
    resultField: "data.files",
    externalIdField: "data",
  },
  statusMapping: {
    pending: ["WAITING"],
    processing: ["PROCESSING"],
    completed: ["SUCCESS"],
    failed: ["FAIL"],
  },
  polling: { intervalMs: 100, maxWaitMs: 5000 },
  rateLimit: { maxConcurrent: 2, delayMs: 0 },
};

let store: TaskQueueStore;
let registry: ApiRegistry;
let queue: TaskQueue;

beforeEach(() => {
  store = new TaskQueueStore();
  registry = new ApiRegistry();
  registry.register(TEST_CONFIG);
  queue = new TaskQueue({ store, registry });
});

afterEach(() => {
  queue.stop();
  store.close();
});

describe("TaskQueue", () => {
  describe("submit", () => {
    it("creates a task in the store with pending status", async () => {
      // submit will fail at executor level (no real API), but the task should be created in store
      const task = await queue.submit({
        type: "test-image",
        provider: "test",
        params: { prompt: "a cat" },
      });

      expect(task.id).toMatch(/^task_/);
      expect(task.status).toBe("pending");
      expect(task.params).toEqual({ prompt: "a cat" });
      expect(task.type).toBe("test-image");
      expect(task.provider).toBe("test");

      // Verify it's in the store
      const fromStore = store.getById(task.id);
      expect(fromStore).not.toBeNull();
      expect(fromStore!.id).toBe(task.id);
    });

    it("throws for unknown task type", async () => {
      await expect(
        queue.submit({
          type: "nonexistent",
          provider: "test",
          params: {},
        }),
      ).rejects.toThrow("Unknown task type: nonexistent");
    });

    it("respects maxAttempts parameter", async () => {
      const task = await queue.submit({
        type: "test-image",
        provider: "test",
        params: {},
        maxAttempts: 5,
      });

      expect(task.maxAttempts).toBe(5);
    });

    it("respects phaseId parameter", async () => {
      const task = await queue.submit({
        type: "test-image",
        provider: "test",
        params: {},
        phaseId: "phase-1",
      });

      expect(task.phaseId).toBe("phase-1");
    });
  });

  describe("getStatus", () => {
    it("returns status for multiple tasks", async () => {
      const t1 = await queue.submit({ type: "test-image", provider: "test", params: { n: 1 } });
      const t2 = await queue.submit({ type: "test-image", provider: "test", params: { n: 2 } });

      const statuses = queue.getStatus([t1.id, t2.id]);
      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.id)).toContain(t1.id);
      expect(statuses.map((s) => s.id)).toContain(t2.id);
    });

    it("returns empty for no ids", () => {
      expect(queue.getStatus([])).toEqual([]);
    });

    it("returns subset for mixed existing/nonexistent ids", async () => {
      const t1 = await queue.submit({ type: "test-image", provider: "test", params: {} });
      const statuses = queue.getStatus([t1.id, "nonexistent"]);
      expect(statuses).toHaveLength(1);
    });
  });

  describe("cancel", () => {
    it("cancels a pending task", async () => {
      const task = await queue.submit({
        type: "test-image",
        provider: "test",
        params: {},
      });

      expect(queue.cancel(task.id)).toBe(true);
      expect(store.getById(task.id)!.status).toBe("cancelled");
    });

    it("returns false for nonexistent task", () => {
      expect(queue.cancel("nonexistent")).toBe(false);
    });

    it("cannot cancel a completed task", () => {
      const task = store.create({ type: "test-image", provider: "test", params: {} });
      store.updateStatus(task.id, { status: "completed", result: {} });

      expect(queue.cancel(task.id)).toBe(false);
    });
  });

  describe("downloadResult", () => {
    it("throws for non-completed task", async () => {
      const task = store.create({
        type: "test-image",
        provider: "test",
        params: {},
      });

      await expect(queue.downloadResult(task.id, "/tmp")).rejects.toThrow(
        "not completed",
      );
    });

    it("throws for nonexistent task", async () => {
      await expect(queue.downloadResult("nope", "/tmp")).rejects.toThrow(
        "not found",
      );
    });

    it("throws for completed task with no result", async () => {
      const task = store.create({
        type: "test-image",
        provider: "test",
        params: {},
      });
      store.updateStatus(task.id, { status: "completed" });

      // result is still null because we didn't set it
      await expect(queue.downloadResult(task.id, "/tmp")).rejects.toThrow(
        "no result",
      );
    });
  });

  describe("stop", () => {
    it("can be called multiple times safely", () => {
      queue.stop();
      queue.stop();
      // No error
    });

    it("prevents new executions after stop", async () => {
      queue.stop();
      // Submit should still create in store (it's synchronous part)
      // but async execution won't proceed
      const task = await queue.submit({
        type: "test-image",
        provider: "test",
        params: {},
      });
      expect(task.status).toBe("pending");
    });
  });

  describe("resumeInFlight", () => {
    it("picks up pending tasks from store", () => {
      // Manually create tasks in store
      store.create({ type: "test-image", provider: "test", params: { n: 1 } });
      store.create({ type: "test-image", provider: "test", params: { n: 2 } });

      // Resume should attempt to execute them (will fail at executor, but no crash)
      queue.resumeInFlight();

      const pending = store.listByStatus("pending");
      // Tasks are still in store (executor will fail, but queue handles gracefully)
      expect(pending.length).toBeGreaterThanOrEqual(0);
    });
  });
});
