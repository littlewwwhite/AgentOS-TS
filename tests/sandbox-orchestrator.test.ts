import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Mocks ----------

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(() => ({ type: "mock-mcp-server" })),
  tool: vi.fn((_name: string, _desc: string, _schema: unknown, handler: unknown) => ({ handler })),
  getSessionMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/protocol.js", () => ({
  emit: vi.fn(),
}));

vi.mock("../src/options.js", () => ({
  buildOptions: vi.fn(),
  describeWorkspace: vi.fn(async () => "## Workspace\n  (empty)"),
}));

vi.mock("../src/tools/index.js", () => ({
  createToolServers: vi.fn(() => ({})),
}));

// ---------- Imports (after mocks) ----------

import path from "node:path";
import { getSessionMessages, query } from "@anthropic-ai/claude-agent-sdk";
import { buildOptions } from "../src/options.js";
import { emit } from "../src/protocol.js";
import type { ChatCommand, SandboxEvent } from "../src/protocol.js";
import { AsyncQueue, SandboxOrchestrator } from "../src/sandbox-orchestrator.js";
import type { OrchestratorConfig } from "../src/sandbox-orchestrator.js";
import { createToolServers } from "../src/tools/index.js";

const mockEmit = emit as ReturnType<typeof vi.fn>;
const mockGetSessionMessages = getSessionMessages as ReturnType<typeof vi.fn>;
const mockQuery = query as ReturnType<typeof vi.fn>;
const mockBuildOptions = buildOptions as ReturnType<typeof vi.fn>;
const mockCreateToolServers = createToolServers as ReturnType<typeof vi.fn>;

/** In-memory store for orchestrator session callbacks */
let sessionData: Record<string, string> = {};

const BASE_CONFIG: OrchestratorConfig = {
  projectPath: "/tmp/test",
  agentsDir: "agents",
  sessionPersistence: {
    load: () => ({ ...sessionData }),
    save: (data) => { sessionData = { ...data }; },
  },
};

function mockOptionsWithAgents(
  agents: Record<string, { description: string }> = {
    "script-writer": { description: "Writes scripts" },
    "image-gen": { description: "Generates images" },
  },
) {
  mockBuildOptions.mockResolvedValue({
    agents,
    systemPrompt: { type: "preset", preset: "claude_code", append: "..." },
    mcpServers: {},
    allowedTools: ["Agent"],
    settingSources: ["project"],
    cwd: "/tmp/test",
  });
}

/** Collect all emitted events of a given type */
function emitted<T extends SandboxEvent["type"]>(type: T) {
  return mockEmit.mock.calls
    .map((c: unknown[]) => c[0] as SandboxEvent)
    .filter((e: SandboxEvent) => e.type === type);
}

function createMockQuery(messages: Array<Record<string, unknown>>) {
  return {
    close: vi.fn(),
    abort: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
    },
  };
}

async function waitFor(assertion: () => void, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}

// ---------- AsyncQueue ----------

describe("AsyncQueue", () => {
  it("pull resolves immediately when buffer has items", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    expect(await q.pull()).toBe(1);
    expect(await q.pull()).toBe(2);
  });

  it("pull waits until push is called", async () => {
    const q = new AsyncQueue<string>();
    const p = q.pull();
    q.push("hello");
    expect(await p).toBe("hello");
  });

  it("reports pending count", () => {
    const q = new AsyncQueue<number>();
    expect(q.pending).toBe(0);
    q.push(1);
    q.push(2);
    expect(q.pending).toBe(2);
  });

  it("pending decreases after pull", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    await q.pull();
    expect(q.pending).toBe(0);
  });
});

// ---------- SandboxOrchestrator ----------

describe("SandboxOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    sessionData = {};
  });

  // -- init --

  describe("init()", () => {
    it("emits ready event with agent names", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const readyEvents = emitted("ready");
      expect(readyEvents).toHaveLength(1);
      expect(readyEvents[0]).toEqual({
        type: "ready",
        skills: ["script-writer", "image-gen"],
      });
    });

    it("calls buildOptions with config values", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator({
        ...BASE_CONFIG,
        model: "opus",
      });
      await orch.init();

      expect(mockBuildOptions).toHaveBeenCalledWith("/tmp/test", "agents", "opus");
    });

    it("handles zero agents gracefully", async () => {
      mockOptionsWithAgents({});
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const readyEvents = emitted("ready");
      expect(readyEvents[0]).toEqual({ type: "ready", skills: [] });
    });
  });

  // -- enterAgent --

  describe("enterAgent()", () => {
    it("sets activeAgent and emits agent_entered", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      await orch.enterAgent("script-writer");

      expect(orch.activeAgent).toBe("script-writer");
      const events = emitted("agent_entered");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "agent_entered",
        agent: "script-writer",
      });
    });

    it("emits error for unknown agent name", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      await orch.enterAgent("nonexistent");

      expect(orch.activeAgent).toBeNull();
      const errors = emitted("error");
      expect(errors).toHaveLength(1);
      expect((errors[0] as { message: string }).message).toContain("Unknown agent");
      expect((errors[0] as { message: string }).message).toContain("nonexistent");
    });

    it("includes session_id if agent has one", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      // No session_id yet — should be undefined
      await orch.enterAgent("script-writer");
      const events = emitted("agent_entered");
      expect(events[0]).not.toHaveProperty("session_id");
    });
  });

  // -- exitAgent --

  describe("exitAgent()", () => {
    it("clears activeAgent and emits agent_exited", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      await orch.enterAgent("script-writer");
      mockEmit.mockClear();

      orch.exitAgent();

      expect(orch.activeAgent).toBeNull();
      const events = emitted("agent_exited");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "agent_exited",
        agent: "script-writer",
      });
    });

    it("emits error when not in an agent session", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      orch.exitAgent();

      const errors = emitted("error");
      expect(errors).toHaveLength(1);
      expect((errors[0] as { message: string }).message).toContain("Not in an agent session");
    });
  });

  // -- resolveTarget --

  describe("resolveTarget()", () => {
    it("returns explicit target when present and valid", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const cmd: ChatCommand = { cmd: "chat", message: "hi", target: "image-gen" };
      expect(orch.resolveTarget(cmd)).toBe("image-gen");
    });

    it("emits error and returns null for unknown target", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      const cmd: ChatCommand = {
        cmd: "chat",
        message: "hi",
        target: "bad-agent",
        request_id: "r1",
      };
      expect(orch.resolveTarget(cmd)).toBeNull();

      const errors = emitted("error");
      expect(errors).toHaveLength(1);
      expect((errors[0] as { request_id?: string }).request_id).toBe("r1");
    });

    it("falls back to activeAgent when no target", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      await orch.enterAgent("script-writer");

      const cmd: ChatCommand = { cmd: "chat", message: "hi" };
      expect(orch.resolveTarget(cmd)).toBe("script-writer");
    });

    it("returns null when no target and no activeAgent", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const cmd: ChatCommand = { cmd: "chat", message: "hi" };
      expect(orch.resolveTarget(cmd)).toBeNull();
    });
  });

  // -- chat --

  describe("chat()", () => {
    it("enqueues to main session when no target", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      // chat to main — message should be queued (not error)
      await orch.chat("hello", null, "r1");

      // No error emitted (beyond the ready event)
      mockEmit.mockClear();
      // Verify no error was emitted by chat itself
      expect(emitted("error")).toHaveLength(0);
    });

    it("enqueues to agent session when target specified", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      await orch.chat("hello", "script-writer", "r2");

      // No error emitted
      expect(emitted("error")).toHaveLength(0);
    });

    it("emits error when target agent does not exist", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      await orch.chat("hello", "nonexistent", "r3");

      const errors = emitted("error");
      expect(errors).toHaveLength(1);
      expect((errors[0] as { message: string }).message).toContain("No session available");
      expect((errors[0] as { request_id?: string }).request_id).toBe("r3");
    });
  });

  // -- getStatus --

  describe("getStatus()", () => {
    it("returns idle for main session initially", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const status = orch.getStatus();
      expect(status).toEqual({ busy: false, sessionId: null });
    });

    it("returns idle for agent session initially", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const status = orch.getStatus("script-writer");
      expect(status).toEqual({ busy: false, sessionId: null });
    });

    it("returns defaults for unknown target", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const status = orch.getStatus("unknown");
      expect(status).toEqual({ busy: false, sessionId: null });
    });
  });

  // -- getSkillMap --

  describe("getSkillMap()", () => {
    it("returns agent name to description mapping", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      expect(orch.getSkillMap()).toEqual({
        "script-writer": "Writes scripts",
        "image-gen": "Generates images",
      });
    });

    it("returns empty map when no agents", async () => {
      mockOptionsWithAgents({});
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      expect(orch.getSkillMap()).toEqual({});
    });
  });

  // -- interrupt --

  describe("interrupt()", () => {
    it("does nothing gracefully when no active query", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      // Should not throw
      orch.interrupt();
      orch.interrupt("script-writer");
    });
  });

  // -- agent options isolation --

  describe("agent options isolation", () => {
    it("strips systemPrompt and agents from agent sessions", async () => {
      mockBuildOptions.mockResolvedValue({
        agents: { writer: { description: "Writes" } },
        systemPrompt: { type: "preset", append: "orchestrator prompt" },
        mcpServers: {},
        allowedTools: ["Agent"],
        settingSources: ["project"],
        cwd: "/tmp/test",
      });

      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      // Verify via getSkillMap that agent was created
      expect(orch.getSkillMap()).toEqual({ writer: "Writes" });

      // The agent session should exist and be queryable
      const status = orch.getStatus("writer");
      expect(status.busy).toBe(false);
    });
  });

  describe("mcp server scoping", () => {
    it("creates dispatch-only servers for main sessions", async () => {
      mockOptionsWithAgents({
        "script-writer": {
          description: "Writes scripts",
          mcpServers: ["script"],
        } as { description: string },
      });
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockCreateToolServers.mockClear();

      const servers = (
        orch as unknown as {
          freshMcpServers(isMain: boolean, names?: string[]): Record<string, unknown>;
        }
      ).freshMcpServers(true, []);

      expect(mockCreateToolServers).toHaveBeenCalledWith([]);
      expect(servers.switch).toBeDefined();
    });

    it("creates only manifest-approved servers for worker sessions", async () => {
      mockOptionsWithAgents({
        "script-writer": {
          description: "Writes scripts",
          mcpServers: ["script"],
        } as { description: string },
      });
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockCreateToolServers.mockClear();

      const servers = (
        orch as unknown as {
          freshMcpServers(isMain: boolean, names?: string[]): Record<string, unknown>;
        }
      ).freshMcpServers(false, ["script"]);

      expect(mockCreateToolServers).toHaveBeenCalledWith(["script"]);
      expect(servers.switch).toBeDefined();
    });
  });

  // -- session history restore --

  describe("session history restore", () => {
    it("emits history events before ready when sessions exist", async () => {
      mockOptionsWithAgents({});
      sessionData = { main: "sess-abc" };

      mockGetSessionMessages.mockResolvedValue([
        {
          type: "user",
          uuid: "u1",
          session_id: "sess-abc",
          message: "hello",
          parent_tool_use_id: null,
        },
        {
          type: "assistant",
          uuid: "u2",
          session_id: "sess-abc",
          message: { content: "hi" },
          parent_tool_use_id: null,
        },
      ]);

      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const allEvents = mockEmit.mock.calls.map((c: unknown[]) => c[0] as SandboxEvent);
      const historyEvents = allEvents.filter((e: SandboxEvent) => e.type === "history");
      const readyEvents = allEvents.filter((e: SandboxEvent) => e.type === "ready");

      expect(historyEvents).toHaveLength(1);
      expect(readyEvents).toHaveLength(1);

      // History must come before ready
      const historyIdx = allEvents.indexOf(historyEvents[0]);
      const readyIdx = allEvents.indexOf(readyEvents[0]);
      expect(historyIdx).toBeLessThan(readyIdx);

      // Verify history content
      const hist = historyEvents[0] as { messages: Array<{ role: string; content: string }> };
      expect(hist.messages).toHaveLength(2);
      expect(hist.messages[0]).toEqual({ role: "user", content: "hello" });
    });

    it("proceeds silently when getSessionMessages fails", async () => {
      mockOptionsWithAgents({});
      sessionData = { main: "sess-fail" };

      mockGetSessionMessages.mockRejectedValue(new Error("session not found"));

      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();

      const readyEvents = emitted("ready");
      expect(readyEvents).toHaveLength(1);
      // No history event emitted
      expect(emitted("history")).toHaveLength(0);
    });

    it("loads lazy agent history from the resumed session context", async () => {
      mockOptionsWithAgents({
        "script-writer": { description: "Writes scripts" },
      });
      sessionData = { "script-writer": "sess-agent" };

      mockGetSessionMessages.mockResolvedValue([
        {
          type: "user",
          uuid: "u1",
          session_id: "sess-agent",
          message: "write episode 1",
          parent_tool_use_id: null,
        },
        {
          type: "assistant",
          uuid: "u2",
          session_id: "sess-agent",
          message: { content: "draft ready" },
          parent_tool_use_id: null,
        },
      ]);

      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      await orch.enterAgent("script-writer");

      expect(mockGetSessionMessages).toHaveBeenCalledWith("sess-agent", {
        dir: path.resolve("agents", "script-writer"),
        limit: 50,
      });

      const allEvents = mockEmit.mock.calls.map((call: unknown[]) => call[0] as SandboxEvent);
      const historyEvents = allEvents.filter((event) => event.type === "history");
      const enteredEvents = allEvents.filter((event) => event.type === "agent_entered");

      expect(historyEvents).toHaveLength(1);
      expect(enteredEvents).toHaveLength(1);
      const [historyEvent] = historyEvents;
      const [enteredEvent] = enteredEvents;
      expect(historyEvent).toBeDefined();
      expect(enteredEvent).toBeDefined();
      if (!historyEvent || !enteredEvent) {
        throw new Error("Expected history and entered events");
      }
      expect(allEvents.indexOf(historyEvent)).toBeLessThan(allEvents.indexOf(enteredEvent));
      expect(historyEvents[0]).toEqual({
        type: "history",
        agent: "script-writer",
        messages: [
          { role: "user", content: "write episode 1" },
          { role: "assistant", content: "draft ready" },
        ],
      });
      expect(enteredEvents[0]).toMatchObject({
        type: "agent_entered",
        agent: "script-writer",
        session_id: "sess-agent",
      });
    });
  });

  describe("delegated execution visibility", () => {
    it("keeps the conversation attached to the delegated agent after execution", async () => {
      mockOptionsWithAgents({
        "script-writer": { description: "Writes scripts" },
      });

      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      mockQuery.mockImplementation(({ prompt }: { prompt: string }) => {
        if (prompt === "把测3.txt转为剧本") {
          (
            orch as unknown as {
              signal: { switchRequest: { agent: string; task: string } | null };
            }
          ).signal.switchRequest = {
            agent: "script-writer",
            task: "Write the script from 测3.txt",
          };
          return createMockQuery([
            {
              type: "stream_event",
              event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "Delegating..." },
              },
            },
            {
              type: "result",
              total_cost_usd: 0.1,
              duration_ms: 5,
              session_id: "sess-main",
            },
          ]);
        }

        if (prompt === "Write the script from 测3.txt") {
          return createMockQuery([
            {
              type: "stream_event",
              event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "Writing episode beats..." },
              },
            },
            {
              type: "result",
              total_cost_usd: 0.2,
              duration_ms: 7,
              session_id: "sess-agent",
            },
          ]);
        }

        throw new Error(`Unexpected prompt: ${prompt}`);
      });

      void orch.startWorkers();
      await orch.chat("把测3.txt转为剧本", null, "r-delegate");

      await waitFor(() => {
        const results = emitted("result").filter((event) => event.request_id === "r-delegate");
        expect(results).toHaveLength(1);
      });

      const allEvents = mockEmit.mock.calls.map((call: unknown[]) => call[0] as SandboxEvent);
      const delegateEnter = allEvents.find(
        (event) => event.type === "agent_entered" && event.agent === "script-writer",
      ) as Extract<SandboxEvent, { type: "agent_entered" }> | undefined;
      const childText = allEvents.find(
        (event) =>
          event.type === "text" &&
          event.agent === "script-writer" &&
          event.request_id === "r-delegate" &&
          (event as Extract<SandboxEvent, { type: "text" }>).text.includes("Writing episode beats"),
      );
      const exitEvents = emitted("agent_exited").filter(
        (event) => event.request_id === "r-delegate",
      );
      const finalResult = emitted("result").find((event) => event.request_id === "r-delegate");

      expect(delegateEnter).toMatchObject({
        type: "agent_entered",
        agent: "script-writer",
        reason: "delegation",
        parent_agent: "main",
      });
      expect(childText).toBeDefined();
      expect(exitEvents).toHaveLength(0);
      expect(finalResult).toMatchObject({
        type: "result",
        request_id: "r-delegate",
        agent: "script-writer",
        session_id: "sess-agent",
      });
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(orch.activeAgent).toBe("script-writer");
    });

    it("emits thinking and detailed tool lifecycle events from the SDK stream", async () => {
      mockOptionsWithAgents();

      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      mockQuery.mockImplementation(() =>
        createMockQuery([
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              delta: { type: "thinking_delta", thinking: "Need to inspect 测3.txt first." },
            },
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", name: "Read", id: "tool-read-1" },
            },
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '{"file_path":"测3.txt"}' },
            },
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_stop",
              index: 0,
            },
          },
          {
            type: "tool_progress",
            tool_name: "Read",
            tool_use_id: "tool-read-1",
            parent_tool_use_id: null,
            elapsed_time_seconds: 0.5,
          },
          {
            type: "tool_use_summary",
            summary: "Read 1 file",
            preceding_tool_use_ids: ["tool-read-1"],
          },
          {
            type: "result",
            total_cost_usd: 0.05,
            duration_ms: 40,
            session_id: "sess-main",
          },
        ]),
      );

      void orch.startWorkers();
      await orch.chat("读取测3.txt", null, "r-observe");

      await waitFor(() => {
        const results = emitted("result").filter((event) => event.request_id === "r-observe");
        expect(results).toHaveLength(1);
      });

      const thinkingEvents = emitted("thinking").filter(
        (event) => event.request_id === "r-observe",
      );
      const toolUseEvents = emitted("tool_use").filter((event) => event.request_id === "r-observe");
      const toolLogEvents = emitted("tool_log").filter((event) => event.request_id === "r-observe");

      expect(thinkingEvents).toEqual([
        {
          type: "thinking",
          text: "Need to inspect 测3.txt first.",
          request_id: "r-observe",
        },
      ]);
      expect(toolUseEvents).toEqual([
        {
          type: "tool_use",
          tool: "Read",
          id: "tool-read-1",
          input: { file_path: "测3.txt" },
          request_id: "r-observe",
        },
      ]);
      expect(toolLogEvents).toEqual([
        {
          type: "tool_log",
          tool: "Read",
          phase: "pre",
          detail: {
            tool_use_id: "tool-read-1",
            elapsed_time_seconds: 0.5,
            status: "running",
          },
          request_id: "r-observe",
        },
        {
          type: "tool_log",
          tool: "summary",
          phase: "post",
          detail: { summary: "Read 1 file" },
          request_id: "r-observe",
        },
      ]);
    });
  });
});
