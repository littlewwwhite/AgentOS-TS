// input: LocalOrchestrator class under test
// output: Verified state management, routing, and agent-switching behavior
// pos: Unit tests for local orchestration core without SDK or network calls

import { describe, expect, it } from "vitest";
import { AsyncQueue, LocalOrchestrator } from "../src/local-orchestrator.js";
import type { OrchestratorConfig } from "../src/local-orchestrator.js";

// ---------- Helpers ----------

/** Access private fields on LocalOrchestrator without triggering SDK calls */
function internals(orch: LocalOrchestrator) {
  return orch as unknown as {
    agentDefinitions: Record<
      string,
      { description: string; mcpServers?: string[]; configuredSkills?: string[] }
    >;
    mainSession: {
      name: string;
      queue: AsyncQueue<{ prompt: string; requestId?: string }>;
      sessionId: string | null;
      busy: boolean;
      activeQueryHandle: null;
      mcpServerNames: string[];
      options: Record<string, unknown>;
    } | null;
    _activeAgent: string | null;
    sessionsFile: string;
  };
}

const BASE_CONFIG: OrchestratorConfig = {
  projectPath: "/tmp/local-orch-test",
  agentsDir: "agents",
};

// ---------- AsyncQueue ----------

describe("AsyncQueue", () => {
  it("resolves pull immediately when buffer is non-empty", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    expect(await q.pull()).toBe(1);
    expect(await q.pull()).toBe(2);
  });

  it("pull waits until a matching push arrives", async () => {
    const q = new AsyncQueue<string>();
    const pending = q.pull();
    q.push("hello");
    expect(await pending).toBe("hello");
  });

  it("tracks pending count correctly", () => {
    const q = new AsyncQueue<number>();
    expect(q.pending).toBe(0);
    q.push(1);
    q.push(2);
    expect(q.pending).toBe(2);
  });

  it("pending decreases after each pull", async () => {
    const q = new AsyncQueue<number>();
    q.push(42);
    await q.pull();
    expect(q.pending).toBe(0);
  });

  it("services multiple concurrent pullers in FIFO order", async () => {
    const q = new AsyncQueue<number>();
    const a = q.pull();
    const b = q.pull();
    q.push(10);
    q.push(20);
    expect(await a).toBe(10);
    expect(await b).toBe(20);
  });
});

// ---------- LocalOrchestrator — constructor ----------

describe("LocalOrchestrator constructor", () => {
  it("accepts OrchestratorConfig with projectPath and agentsDir", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    // If construction completes without throwing, config is accepted
    expect(orch).toBeInstanceOf(LocalOrchestrator);
  });

  it("derives sessions file path from projectPath", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    expect(internals(orch).sessionsFile).toBe("/tmp/local-orch-test/.sessions.json");
  });

  it("accepts optional model field", () => {
    const orch = new LocalOrchestrator({ ...BASE_CONFIG, model: "claude-opus-4-5" });
    expect(orch).toBeInstanceOf(LocalOrchestrator);
  });

  it("starts with no active agent", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    expect(orch.activeAgent).toBeNull();
  });

  it("starts with empty agentNames", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    expect(orch.agentNames).toEqual([]);
  });
});

// ---------- LocalOrchestrator — state management (pre-init injection) ----------
//
// These tests bypass init() entirely by injecting state directly into private fields.
// This avoids touching the SDK, file system reads for agent configs, or MCP protocol.

describe("LocalOrchestrator — getStatus()", () => {
  function makeOrchWithMainSession() {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    const state = internals(orch);
    // Simulate a post-init main session
    state.mainSession = {
      name: "main",
      queue: new AsyncQueue(),
      sessionId: null,
      busy: false,
      activeQueryHandle: null,
      mcpServerNames: [],
      options: {},
    };
    return orch;
  }

  it("returns idle and null sessionId for fresh main session", () => {
    const orch = makeOrchWithMainSession();
    expect(orch.getStatus(null)).toEqual({ busy: false, sessionId: null });
  });

  it("reflects sessionId once set on main session", () => {
    const orch = makeOrchWithMainSession();
    internals(orch).mainSession!.sessionId = "sess-abc";
    expect(orch.getStatus(null)).toEqual({ busy: false, sessionId: "sess-abc" });
  });

  it("reflects busy=true when main session is processing", () => {
    const orch = makeOrchWithMainSession();
    internals(orch).mainSession!.busy = true;
    expect(orch.getStatus(null).busy).toBe(true);
  });

  it("returns safe defaults when target agent has no session yet", () => {
    const orch = makeOrchWithMainSession();
    // "unknown-agent" was never created
    expect(orch.getStatus("unknown-agent")).toEqual({ busy: false, sessionId: null });
  });
});

describe("LocalOrchestrator — getSkillMap()", () => {
  it("returns empty map when no agents defined", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    expect(orch.getSkillMap()).toEqual({});
  });

  it("returns name-to-description mapping for injected agents", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    internals(orch).agentDefinitions = {
      "script-writer": { description: "Writes scripts" },
      "image-gen": { description: "Generates images" },
    };
    expect(orch.getSkillMap()).toEqual({
      "script-writer": "Writes scripts",
      "image-gen": "Generates images",
    });
  });
});

describe("LocalOrchestrator — agentNames", () => {
  it("returns empty array with no agents", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    expect(orch.agentNames).toEqual([]);
  });

  it("returns all agent names from agentDefinitions", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    internals(orch).agentDefinitions = {
      "art-director": { description: "Directs art" },
      "post-production": { description: "Post prod" },
    };
    expect(orch.agentNames.sort()).toEqual(["art-director", "post-production"]);
  });
});

describe("LocalOrchestrator — interrupt()", () => {
  it("does not throw when main session has no active query", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    const state = internals(orch);
    state.mainSession = {
      name: "main",
      queue: new AsyncQueue(),
      sessionId: null,
      busy: false,
      activeQueryHandle: null,
      mcpServerNames: [],
      options: {},
    };
    expect(() => orch.interrupt(null)).not.toThrow();
  });

  it("does not throw when target agent does not exist", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    expect(() => orch.interrupt("nonexistent")).not.toThrow();
  });

  it("clears activeQueryHandle when a handle is present", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    const closeSpy = { called: false };
    const fakeHandle = {
      query: { close: () => { closeSpy.called = true; } },
    };
    const state = internals(orch);
    state.mainSession = {
      name: "main",
      queue: new AsyncQueue(),
      sessionId: null,
      busy: true,
      activeQueryHandle: fakeHandle as unknown as null,
      mcpServerNames: [],
      options: {},
    };
    orch.interrupt(null);
    expect(closeSpy.called).toBe(true);
    expect(state.mainSession!.activeQueryHandle).toBeNull();
  });
});

// ---------- LocalOrchestrator — agent context switching ----------
//
// enterAgent / exitAgent use agentDefinitions + emit() which writes to stdout.
// We capture stdout output to verify the emitted protocol events.

describe("LocalOrchestrator — exitAgent()", () => {
  it("emits error event when not in an agent session", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      written.push(s);
      return true;
    };
    try {
      orch.exitAgent();
    } finally {
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }
    const events = written
      .map((s) => { try { return JSON.parse(s.trim()); } catch { return null; } })
      .filter(Boolean);
    const errorEvent = events.find((e: Record<string, unknown>) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as Record<string, unknown>).message).toContain("Not in an agent session");
  });

  it("clears activeAgent and emits agent_exited after enterAgent", async () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    // Inject agent definition so enterAgent can route without file I/O
    internals(orch).agentDefinitions = {
      "script-writer": { description: "Writes scripts" },
    };

    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      written.push(s);
      return true;
    };

    try {
      // enterAgent calls getOrCreateAgent which tries buildAgentOptions and runWorker
      // — skip that path and inject activeAgent directly to test exitAgent in isolation
      internals(orch)._activeAgent = "script-writer";
      orch.exitAgent();
    } finally {
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }

    expect(orch.activeAgent).toBeNull();

    const events = written
      .map((s) => { try { return JSON.parse(s.trim()); } catch { return null; } })
      .filter(Boolean);
    const exitedEvent = events.find(
      (e: Record<string, unknown>) => e.type === "agent_exited",
    );
    expect(exitedEvent).toBeDefined();
    expect((exitedEvent as Record<string, unknown>).agent).toBe("script-writer");
  });
});

// ---------- LocalOrchestrator — chat() queue routing ----------

describe("LocalOrchestrator — chat() queue routing", () => {
  it("pushes message to main session queue when no target", async () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    const mainQueue = new AsyncQueue<{ prompt: string; requestId?: string }>();
    internals(orch).mainSession = {
      name: "main",
      queue: mainQueue,
      sessionId: null,
      busy: false,
      activeQueryHandle: null,
      mcpServerNames: [],
      options: {},
    };

    await orch.chat("hello world", null, "req-1");

    expect(mainQueue.pending).toBe(1);
    const item = await mainQueue.pull();
    expect(item).toEqual({ prompt: "hello world", requestId: "req-1" });
  });

  it("emits error when no main session exists (pre-init)", async () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    // mainSession is null by default before init()

    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      written.push(s);
      return true;
    };
    try {
      await orch.chat("hello", null, "req-2");
    } finally {
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }

    const events = written
      .map((s) => { try { return JSON.parse(s.trim()); } catch { return null; } })
      .filter(Boolean);
    const errorEvent = events.find((e: Record<string, unknown>) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as Record<string, unknown>).request_id).toBe("req-2");
  });
});

// ---------- LocalOrchestrator — resolveTarget ----------

describe("LocalOrchestrator — resolveTarget()", () => {
  it("returns null when no target and no activeAgent", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    internals(orch).agentDefinitions = {
      "script-writer": { description: "Writes scripts" },
    };
    const result = orch.resolveTarget({ cmd: "chat", message: "hi" });
    expect(result).toBeNull();
  });

  it("returns activeAgent when no explicit target", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    internals(orch)._activeAgent = "script-writer";
    internals(orch).agentDefinitions = {
      "script-writer": { description: "Writes scripts" },
    };
    const result = orch.resolveTarget({ cmd: "chat", message: "hi" });
    expect(result).toBe("script-writer");
  });

  it("returns explicit target when it exists in agentDefinitions", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    internals(orch).agentDefinitions = {
      "image-gen": { description: "Generates images" },
    };
    const result = orch.resolveTarget({ cmd: "chat", message: "hi", target: "image-gen" });
    expect(result).toBe("image-gen");
  });

  it("emits error and returns null for unknown explicit target", () => {
    const orch = new LocalOrchestrator(BASE_CONFIG);
    internals(orch).agentDefinitions = {};

    const written: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      written.push(s);
      return true;
    };
    let result: string | null;
    try {
      result = orch.resolveTarget({
        cmd: "chat",
        message: "hi",
        target: "bad-agent",
        request_id: "r-err",
      });
    } finally {
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }

    expect(result!).toBeNull();
    const events = written
      .map((s) => { try { return JSON.parse(s.trim()); } catch { return null; } })
      .filter(Boolean);
    const errorEvent = events.find((e: Record<string, unknown>) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as Record<string, unknown>).request_id).toBe("r-err");
  });
});
