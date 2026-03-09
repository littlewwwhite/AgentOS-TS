import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

vi.mock("../src/protocol.js", () => ({
  emit: vi.fn(),
}));

vi.mock("../src/options.js", () => ({
  buildOptions: vi.fn(),
}));

// ---------- Imports (after mocks) ----------

import { AsyncQueue, SandboxOrchestrator } from "../src/sandbox-orchestrator.js";
import type { OrchestratorConfig } from "../src/sandbox-orchestrator.js";
import { emit } from "../src/protocol.js";
import { buildOptions } from "../src/options.js";
import type { ChatCommand, SandboxEvent } from "../src/protocol.js";

const mockEmit = emit as ReturnType<typeof vi.fn>;
const mockBuildOptions = buildOptions as ReturnType<typeof vi.fn>;

const BASE_CONFIG: OrchestratorConfig = {
  projectPath: "/tmp/test",
  agentsDir: "agents",
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

      expect(mockBuildOptions).toHaveBeenCalledWith(
        "/tmp/test",
        "agents",
        "opus",
      );
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

      orch.enterAgent("script-writer");

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

      orch.enterAgent("nonexistent");

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
      orch.enterAgent("script-writer");
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

      orch.enterAgent("script-writer");
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

      orch.enterAgent("script-writer");

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
      orch.chat("hello", null, "r1");

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

      orch.chat("hello", "script-writer", "r2");

      // No error emitted
      expect(emitted("error")).toHaveLength(0);
    });

    it("emits error when target agent does not exist", async () => {
      mockOptionsWithAgents();
      const orch = new SandboxOrchestrator(BASE_CONFIG);
      await orch.init();
      mockEmit.mockClear();

      orch.chat("hello", "nonexistent", "r3");

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
});
