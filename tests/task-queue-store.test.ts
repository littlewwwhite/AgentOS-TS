import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TaskQueueStore, type TaskStatus } from "../src/task-queue/store.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createStoreFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-task-store-"));
  tempDirs.push(dir);
  return path.join(dir, "tasks.db");
}

describe("TaskQueueStore", () => {
  it("creates a task with pending status", () => {
    const store = new TaskQueueStore();
    const task = store.create({
      type: "animeworkbench-image",
      provider: "animeworkbench",
      params: { modelCode: "test", taskPrompt: "a cat" },
    });

    expect(task.id).toMatch(/^task_/);
    expect(task.type).toBe("animeworkbench-image");
    expect(task.provider).toBe("animeworkbench");
    expect(task.status).toBe("pending");
    expect(task.params).toEqual({ modelCode: "test", taskPrompt: "a cat" });
    expect(task.result).toBeNull();
    expect(task.error).toBeNull();
    expect(task.externalId).toBeNull();
    expect(task.attempt).toBe(0);
    expect(task.maxAttempts).toBe(3);
    expect(task.phaseId).toBeNull();
    expect(typeof task.createdAt).toBe("number");
    expect(typeof task.updatedAt).toBe("number");
  });

  it("creates a task with custom maxAttempts and phaseId", () => {
    const store = new TaskQueueStore();
    const task = store.create({
      type: "animeworkbench-video",
      provider: "animeworkbench",
      params: { prompt: "test" },
      maxAttempts: 5,
      phaseId: "phase-1",
    });

    expect(task.maxAttempts).toBe(5);
    expect(task.phaseId).toBe("phase-1");
  });

  it("retrieves task by id", () => {
    const store = new TaskQueueStore();
    const task = store.create({
      type: "animeworkbench-image",
      provider: "animeworkbench",
      params: { prompt: "test" },
    });

    const retrieved = store.getById(task.id);
    expect(retrieved).toEqual(task);
  });

  it("returns null for nonexistent task", () => {
    const store = new TaskQueueStore();
    expect(store.getById("nonexistent")).toBeNull();
  });

  it("updates task status with externalId", () => {
    const store = new TaskQueueStore();
    const task = store.create({
      type: "animeworkbench-image",
      provider: "animeworkbench",
      params: { prompt: "test" },
    });

    const updated = store.updateStatus(task.id, {
      status: "submitted",
      externalId: "ext_123",
      attempt: 1,
    });

    expect(updated!.status).toBe("submitted");
    expect(updated!.externalId).toBe("ext_123");
    expect(updated!.attempt).toBe(1);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(task.updatedAt);
  });

  it("updates task status to completed with result", () => {
    const store = new TaskQueueStore();
    const task = store.create({
      type: "animeworkbench-image",
      provider: "animeworkbench",
      params: { prompt: "test" },
    });

    const updated = store.updateStatus(task.id, {
      status: "completed",
      result: { files: ["https://cdn.example.com/image.png"] },
    });

    expect(updated!.status).toBe("completed");
    expect(updated!.result).toEqual({ files: ["https://cdn.example.com/image.png"] });
  });

  it("updates task status to failed with error", () => {
    const store = new TaskQueueStore();
    const task = store.create({
      type: "animeworkbench-image",
      provider: "animeworkbench",
      params: { prompt: "test" },
    });

    const updated = store.updateStatus(task.id, {
      status: "failed",
      error: "API timeout",
      attempt: 3,
    });

    expect(updated!.status).toBe("failed");
    expect(updated!.error).toBe("API timeout");
    expect(updated!.attempt).toBe(3);
  });

  it("returns null when updating nonexistent task", () => {
    const store = new TaskQueueStore();
    expect(store.updateStatus("nonexistent", { status: "failed" })).toBeNull();
  });

  it("lists tasks by status", () => {
    const store = new TaskQueueStore();
    const t1 = store.create({ type: "img", provider: "p", params: {} });
    const t2 = store.create({ type: "img", provider: "p", params: {} });
    store.create({ type: "img", provider: "p", params: {} });

    store.updateStatus(t1.id, { status: "submitted" });
    store.updateStatus(t2.id, { status: "completed", result: {} });

    const pending = store.listByStatus("pending");
    expect(pending).toHaveLength(1);

    const submitted = store.listByStatus("submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0].id).toBe(t1.id);

    const multi = store.listByStatus("pending", "submitted");
    expect(multi).toHaveLength(2);
  });

  it("lists tasks by phase", () => {
    const store = new TaskQueueStore();
    store.create({ type: "img", provider: "p", params: {}, phaseId: "phase-1" });
    store.create({ type: "img", provider: "p", params: {}, phaseId: "phase-1" });
    store.create({ type: "img", provider: "p", params: {}, phaseId: "phase-2" });

    const phase1 = store.listByPhase("phase-1");
    expect(phase1).toHaveLength(2);

    const phase2 = store.listByPhase("phase-2");
    expect(phase2).toHaveLength(1);
  });

  it("batch retrieves tasks by ids", () => {
    const store = new TaskQueueStore();
    const t1 = store.create({ type: "img", provider: "p", params: {} });
    const t2 = store.create({ type: "vid", provider: "p", params: {} });
    store.create({ type: "aud", provider: "p", params: {} });

    const batch = store.getMany([t1.id, t2.id]);
    expect(batch).toHaveLength(2);
    expect(batch.map((t) => t.id)).toContain(t1.id);
    expect(batch.map((t) => t.id)).toContain(t2.id);
  });

  it("returns empty array for empty getMany", () => {
    const store = new TaskQueueStore();
    expect(store.getMany([])).toEqual([]);
  });

  it("cancels a pending task", () => {
    const store = new TaskQueueStore();
    const task = store.create({ type: "img", provider: "p", params: {} });

    expect(store.cancel(task.id)).toBe(true);
    expect(store.getById(task.id)!.status).toBe("cancelled");
  });

  it("cancels a submitted task", () => {
    const store = new TaskQueueStore();
    const task = store.create({ type: "img", provider: "p", params: {} });
    store.updateStatus(task.id, { status: "submitted", externalId: "ext_1" });

    expect(store.cancel(task.id)).toBe(true);
    expect(store.getById(task.id)!.status).toBe("cancelled");
  });

  it("cannot cancel a completed task", () => {
    const store = new TaskQueueStore();
    const task = store.create({ type: "img", provider: "p", params: {} });
    store.updateStatus(task.id, { status: "completed", result: {} });

    expect(store.cancel(task.id)).toBe(false);
    expect(store.getById(task.id)!.status).toBe("completed");
  });

  it("cannot cancel a failed task", () => {
    const store = new TaskQueueStore();
    const task = store.create({ type: "img", provider: "p", params: {} });
    store.updateStatus(task.id, { status: "failed", error: "err" });

    expect(store.cancel(task.id)).toBe(false);
  });

  it("returns false when cancelling nonexistent task", () => {
    const store = new TaskQueueStore();
    expect(store.cancel("nonexistent")).toBe(false);
  });

  it("persists tasks to SQLite file", () => {
    const filePath = createStoreFile();
    const store = new TaskQueueStore(filePath);

    const task = store.create({
      type: "animeworkbench-image",
      provider: "animeworkbench",
      params: { modelCode: "test", taskPrompt: "a cat" },
      maxAttempts: 5,
      phaseId: "phase-1",
    });

    store.updateStatus(task.id, {
      status: "completed",
      externalId: "ext_456",
      result: { files: ["https://example.com/img.png"] },
    });
    store.close();

    // Re-open from same file
    const store2 = new TaskQueueStore(filePath);
    const restored = store2.getById(task.id);

    expect(restored).not.toBeNull();
    expect(restored!.type).toBe("animeworkbench-image");
    expect(restored!.status).toBe("completed");
    expect(restored!.externalId).toBe("ext_456");
    expect(restored!.result).toEqual({ files: ["https://example.com/img.png"] });
    expect(restored!.maxAttempts).toBe(5);
    expect(restored!.phaseId).toBe("phase-1");
    store2.close();
  });

  it("generates unique task ids", () => {
    const store = new TaskQueueStore();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const task = store.create({ type: "img", provider: "p", params: {} });
      ids.add(task.id);
    }
    expect(ids.size).toBe(100);
  });

  it("returns empty array for listByStatus with no args", () => {
    const store = new TaskQueueStore();
    store.create({ type: "img", provider: "p", params: {} });
    expect(store.listByStatus()).toEqual([]);
  });
});
