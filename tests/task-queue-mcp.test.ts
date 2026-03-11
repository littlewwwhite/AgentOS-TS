import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskQueue } from "../src/task-queue/queue.js";
import { TaskQueueStore } from "../src/task-queue/store.js";
import { ApiRegistry, type ApiConfig } from "../src/task-queue/registry.js";
import { createTaskTools } from "../src/task-queue/tools.js";

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
let tools: ReturnType<typeof createTaskTools>;

beforeEach(() => {
  store = new TaskQueueStore();
  registry = new ApiRegistry();
  registry.register(TEST_CONFIG);
  queue = new TaskQueue({ store, registry });
  tools = createTaskTools(queue);
});

afterEach(() => {
  queue.stop();
  store.close();
});

describe("Task Queue MCP Tools", () => {
  it("exports exactly 4 tools", () => {
    expect(tools).toHaveLength(4);
  });

  it("has all expected tool names", () => {
    const names = tools.map((t) => (t as { name: string }).name);
    expect(names).toContain("submit_task");
    expect(names).toContain("check_tasks");
    expect(names).toContain("cancel_task");
    expect(names).toContain("download_result");
  });

  it("each tool has name and description", () => {
    for (const tool of tools) {
      const t = tool as { name: string; description: string };
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it("tools are distinct objects for each createTaskTools call", () => {
    const tools2 = createTaskTools(queue);
    expect(tools).not.toBe(tools2);
    // But same count
    expect(tools2).toHaveLength(4);
  });
});
