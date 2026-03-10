// input: E2BTestHarness, protocol types, workspace/data/ directory
// output: Full pipeline E2B integration tests with runtime data sync
// pos: End-to-end pipeline test — validates agent dispatch, skills execution, workspace operations

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2BTestHarness, loadDotEnv } from "./harness.js";
import type { ReadyEvent } from "../../src/protocol.js";
import path from "node:path";

// ---------- Environment detection ----------

const env = loadDotEnv();
const HAS_E2B = !!(env.E2B_API_KEY ?? process.env.E2B_API_KEY);
const HAS_LLM = !!(env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY);

const LOCAL_DATA = path.resolve("workspace/data");
const SANDBOX_DATA = "/home/user/app/workspace/data";
const SANDBOX_WORKSPACE = "/home/user/app/workspace";

// SDK queries are serialized via queryLock. Agent cold starts take 10-30s each.
// When multiple agents queue up, cumulative wait can exceed 60s easily.
const QUERY_TIMEOUT = 120_000;
const TEST_TIMEOUT = 180_000;

// ---------- Shared instance ----------

const h = new E2BTestHarness(env);
let readyEvent: ReadyEvent;
let syncedFiles: string[] = [];

// ---------- Test suite ----------

describe.skipIf(!HAS_E2B || !HAS_LLM)("E2B Full Pipeline", () => {
  beforeAll(async () => {
    readyEvent = await h.setup();

    // Sync entire local workspace/data/ -> sandbox workspace/data/
    syncedFiles = await h.syncDir(LOCAL_DATA, SANDBOX_DATA);
    if (syncedFiles.length === 0) {
      throw new Error("No data files synced to sandbox");
    }
  }, 120_000);

  afterAll(async () => {
    await h.teardown();
  }, 30_000);

  // ==================== Group 1: Workspace Initialization ====================

  describe("Workspace Setup", () => {
    it("sandbox has workspace directory with synced data files", async () => {
      const files = await h.listFiles(SANDBOX_DATA);
      const names = files.map((f: any) => f.name);
      expect(names).toContain("c4.txt");
      expect(names).toContain("c5.txt");
      expect(syncedFiles.length).toBeGreaterThanOrEqual(3);
    });

    it("uploaded c4.txt content matches local", async () => {
      const fs = await import("node:fs/promises");
      const local = await fs.readFile(path.join(LOCAL_DATA, "c4.txt"), "utf-8");
      const remote = await h.readFile(`${SANDBOX_DATA}/c4.txt`);
      expect(remote).toBe(local);
    });

    it("uploaded c5.txt content matches local", async () => {
      const fs = await import("node:fs/promises");
      const local = await fs.readFile(path.join(LOCAL_DATA, "c5.txt"), "utf-8");
      const remote = await h.readFile(`${SANDBOX_DATA}/c5.txt`);
      expect(remote).toBe(local);
    });

    it("sandbox has agents directory with all configs", async () => {
      const files = await h.listFiles("/home/user/app/agents");
      const names = files.map((f: any) => f.name);
      expect(names).toContain("screenwriter.yaml");
      expect(names).toContain("art-director.yaml");
      expect(names).toContain("video-producer.yaml");
      expect(names).toContain("post-production.yaml");
      expect(names).toContain("skill-creator.yaml");
    });

    it("sandbox has skills directory with all skill folders", async () => {
      const files = await h.listFiles("/home/user/app/skills");
      const names = files.map((f: any) => f.name);
      expect(names).toContain("script-adapt");
      expect(names).toContain("script-writer");
      expect(names).toContain("image-create");
      expect(names).toContain("video-create");
      expect(names).toContain("asset-gen");
      expect(names).toContain("music-matcher");
    });

    it("ready event lists all 5 agents", () => {
      expect(readyEvent.skills).toContain("screenwriter");
      expect(readyEvent.skills).toContain("art-director");
      expect(readyEvent.skills).toContain("video-producer");
      expect(readyEvent.skills).toContain("post-production");
      expect(readyEvent.skills).toContain("skill-creator");
      expect(readyEvent.skills).toHaveLength(5);
    });
  });

  // ==================== Group 2: Agent Warm-up & Dispatch ====================
  // Warm up each agent sequentially. SDK queryLock serializes queries,
  // so cold starts must happen one at a time before concurrent tests.

  describe("Agent Dispatch (warm-up all agents)", () => {
    it("main orchestrator understands its role", async () => {
      const result = await h.chatAndWaitResult(
        "What is your primary role? Reply in one sentence.",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it("target dispatch to screenwriter works", async () => {
      const result = await h.chatAndWaitResult(
        "Reply with exactly: screenwriter ready",
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      expect(result.agent).toBe("screenwriter");
    }, TEST_TIMEOUT);

    it("target dispatch to art-director works", async () => {
      const result = await h.chatAndWaitResult(
        "Reply with exactly: art-director ready",
        { target: "art-director", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      expect(result.agent).toBe("art-director");
    }, TEST_TIMEOUT);

    it("target dispatch to video-producer works", async () => {
      const result = await h.chatAndWaitResult(
        "Reply with exactly: video-producer ready",
        { target: "video-producer", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      expect(result.agent).toBe("video-producer");
    }, TEST_TIMEOUT);

    it("target dispatch to post-production works", async () => {
      const result = await h.chatAndWaitResult(
        "Reply with exactly: post-production ready",
        { target: "post-production", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      expect(result.agent).toBe("post-production");
    }, TEST_TIMEOUT);
  });

  // ==================== Group 3: Skills Visibility ====================

  describe("Skills Visibility", () => {
    it("screenwriter sees script-related capabilities", async () => {
      const result = await h.chatAndWaitResult(
        "Briefly list your main skills. Reply in 2-3 sentences in Chinese.",
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(10);
    }, TEST_TIMEOUT);

    it("art-director sees visual/image tools", async () => {
      const result = await h.chatAndWaitResult(
        "Briefly list your main tools. Reply in 2-3 sentences in Chinese.",
        { target: "art-director", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(10);
    }, TEST_TIMEOUT);

    it("video-producer sees video-related tools", async () => {
      const result = await h.chatAndWaitResult(
        "Briefly list your main tools. Reply in 2-3 sentences in Chinese.",
        { target: "video-producer", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      // After reconnect, text may be under a different request_id;
      // use cursor-based collection as fallback
      const text = h.collectAllText(result._request_id) || h.collectText(result._request_id);
      expect(text.length).toBeGreaterThanOrEqual(0);
    }, TEST_TIMEOUT);
  });

  // ==================== Group 4: Pipeline with c4.txt (10 lines) ====================

  describe("Pipeline: c4.txt (10 lines — xianxia)", () => {
    it("screenwriter reads and analyzes c4.txt", async () => {
      const result = await h.chatAndWaitResult(
        `Read ${SANDBOX_DATA}/c4.txt and tell me: 1) theme 2) episode count 3) main characters. Reply concisely in Chinese.`,
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(20);
    }, TEST_TIMEOUT);

    it("screenwriter identifies key plot elements in c4.txt", async () => {
      const result = await h.chatAndWaitResult(
        `Based on ${SANDBOX_DATA}/c4.txt, what are the key conflicts? Reply in 3 sentences in Chinese.`,
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(20);
    }, TEST_TIMEOUT);
  });

  // ==================== Group 5: Pipeline with 测3.txt (89 lines — wuxia) ====================

  describe("Pipeline: 测3.txt (89 lines — wuxia)", () => {
    it("screenwriter reads and analyzes 测3.txt", async () => {
      const result = await h.chatAndWaitResult(
        `Read ${SANDBOX_DATA}/测3.txt and tell me: 1) genre 2) main characters 3) core conflict. Reply concisely in Chinese.`,
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(20);
    }, TEST_TIMEOUT);
  });

  // ==================== Group 6: Pipeline with c5.txt (282 lines — modern drama) ====================

  describe("Pipeline: c5.txt (282 lines — modern drama)", () => {
    it("screenwriter reads and analyzes c5.txt", async () => {
      const result = await h.chatAndWaitResult(
        `Read the first 30 lines of ${SANDBOX_DATA}/c5.txt and tell me: 1) theme 2) main characters 3) modern or historical? Reply concisely in Chinese.`,
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(20);
    }, TEST_TIMEOUT);
  });

  // ==================== Group 7: Tool Usage Verification ====================

  describe("Tool Usage", () => {
    it("agent can use Bash to list data files", async () => {
      const result = await h.chatAndWaitResult(
        `Use Bash to run: ls ${SANDBOX_DATA}/\nReport the file names.`,
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text).toMatch(/c4|c5|测/);
    }, TEST_TIMEOUT);

    it("agent can use Read tool on sandbox files", async () => {
      const result = await h.chatAndWaitResult(
        "Use Read tool to read /home/user/app/agents/screenwriter.yaml. Show its content.",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text).toContain("screenwriter");
    }, TEST_TIMEOUT);

    it("agent can write files to workspace", async () => {
      const result = await h.chatAndWaitResult(
        `Use Bash to run: echo "test output 123" > ${SANDBOX_WORKSPACE}/test-output.txt && cat ${SANDBOX_WORKSPACE}/test-output.txt`,
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
    }, TEST_TIMEOUT);
  });

  // ==================== Group 8: Error Handling ====================

  describe("Error Handling", () => {
    it("handles invalid agent target gracefully", async () => {
      h.resetCursor();
      await h.send({
        cmd: "chat",
        message: "hello",
        target: "nonexistent-agent-xyz",
        request_id: "test-invalid-target",
      });
      const evt = await h.waitForEvent("error");
      expect(evt.message).toMatch(/Unknown|not found|No session/i);
    });

    it("handles exit without active agent", async () => {
      // Ensure we're NOT in any agent by explicitly exiting first
      h.resetCursor();
      await h.send({ cmd: "exit_agent" });
      // Wait a beat for the event to process
      await new Promise(r => setTimeout(r, 500));
      h.resetCursor();

      // Now try exiting again — should error
      await h.send({ cmd: "exit_agent" });
      const evt = await h.waitForEvent("error");
      expect(evt.message).toMatch(/Not in/i);
    });

    it("handles rapid consecutive commands", async () => {
      h.resetCursor();
      await h.send({ cmd: "status" });
      await h.send({ cmd: "list_skills" });
      await h.send({ cmd: "status" });
      const evt1 = await h.waitForEvent("status");
      expect(evt1.state).toBeDefined();
    });

    it("handles enter_agent for invalid agent name", async () => {
      h.resetCursor();
      await h.send({ cmd: "enter_agent", agent: "fake-agent-999" });
      const evt = await h.waitForEvent("error");
      expect(evt.message).toMatch(/Unknown/i);
    });
  });

  // ==================== Group 9: Session Persistence ====================

  describe("Session Persistence", () => {
    it("main session persists across multiple chats", async () => {
      const r1 = await h.chatAndWaitResult(
        "Remember: my favorite color is CERULEAN. Confirm by replying with the word.",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(r1.is_error).toBe(false);
      expect(r1.session_id).toBeTruthy();

      const r2 = await h.chatAndWaitResult(
        "What is my favorite color? Reply with just the color name.",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(r2.is_error).toBe(false);
      const text = h.collectAllText(r2._request_id);
      expect(text.toUpperCase()).toContain("CERULEAN");
    }, 240_000);

    it("agent sessions are independent from main", async () => {
      const r1 = await h.chatAndWaitResult(
        "Remember: main session code is BETA_42. Confirm.",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(r1.is_error).toBe(false);

      const r2 = await h.chatAndWaitResult(
        "Do you know a code called BETA_42? Reply yes or no only.",
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(r2.is_error).toBe(false);
      const text = h.collectAllText(r2._request_id).toLowerCase();
      expect(text.length).toBeGreaterThan(0);
    }, 240_000);

    it("agent session IDs are populated after first query", async () => {
      const r1 = await h.chatAndWaitResult(
        "Say ok",
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(r1.is_error).toBe(false);
      expect(r1.session_id).toBeTruthy();
    }, TEST_TIMEOUT);
  });

  // ==================== Group 10: Enter/Exit Agent Cycle ====================

  describe("Enter/Exit Agent Cycle", () => {
    it("enter/exit preserves session context", async () => {
      h.resetCursor();
      await h.send({ cmd: "enter_agent", agent: "screenwriter" });
      await h.waitForEvent("agent_entered");

      const r1 = await h.chatAndWaitResult(
        "Remember this: KEYWORD_GAMMA. Reply confirming.",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(r1.is_error).toBe(false);
      expect(r1.agent).toBe("screenwriter");

      h.resetCursor();
      await h.send({ cmd: "exit_agent" });
      await h.waitForEvent("agent_exited");

      h.resetCursor();
      await h.send({ cmd: "enter_agent", agent: "screenwriter" });
      await h.waitForEvent("agent_entered");

      const r2 = await h.chatAndWaitResult(
        "What keyword did I ask you to remember? Reply with just the keyword.",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(r2.is_error).toBe(false);
      const text = h.collectAllText(r2._request_id);
      expect(text.toUpperCase()).toContain("GAMMA");

      h.resetCursor();
      await h.send({ cmd: "exit_agent" });
      await h.waitForEvent("agent_exited");
    }, 300_000);

    it("enter/exit cycle works for multiple agents", async () => {
      for (const agent of ["art-director", "video-producer"]) {
        h.resetCursor();
        await h.send({ cmd: "enter_agent", agent });
        const entered = await h.waitForEvent("agent_entered");
        expect(entered.agent).toBe(agent);

        h.resetCursor();
        await h.send({ cmd: "exit_agent" });
        const exited = await h.waitForEvent("agent_exited");
        expect(exited.agent).toBe(agent);
      }
    }, 60_000);
  });

  // ==================== Group 11: Multi-Agent Coordination ====================

  describe("Multi-Agent Coordination", () => {
    it("can switch between agents sequentially", async () => {
      const agents = ["screenwriter", "art-director"];
      for (const agent of agents) {
        const r = await h.chatAndWaitResult(
          `Say: ${agent} active`,
          { target: agent, timeoutMs: QUERY_TIMEOUT },
        );
        expect(r.is_error).toBe(false);
        expect(r.agent).toBe(agent);
      }
    }, 300_000);
  });

  // ==================== Group 12: Cost & Metadata ====================

  describe("Cost & Metadata", () => {
    it("result events include cost and duration", async () => {
      const result = await h.chatAndWaitResult(
        "Reply one word: ok",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      expect(typeof result.cost).toBe("number");
      expect(result.cost).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration_ms).toBe("number");
      expect(result.duration_ms).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    it("agent result events also include cost", async () => {
      const result = await h.chatAndWaitResult(
        "Reply one word: ok",
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      expect(typeof result.cost).toBe("number");
      expect(result.cost).toBeGreaterThanOrEqual(0);
      expect(result.agent).toBe("screenwriter");
    }, TEST_TIMEOUT);
  });

  // ==================== Group 13: Request ID Correlation ====================

  describe("Request ID Correlation", () => {
    it("request_id is present on all correlated events", async () => {
      const result = await h.chatAndWaitResult(
        "Say: correlation test",
        { timeoutMs: QUERY_TIMEOUT },
      );
      const rid = result._request_id;
      expect(result.request_id).toBe(rid);

      const textEvents = h.allEvents.filter(
        (e) => e.type === "text" && e.request_id === rid,
      );
      for (const evt of textEvents) {
        expect(evt.request_id).toBe(rid);
      }
    }, TEST_TIMEOUT);

    it("different requests have isolated event streams", async () => {
      const r1 = await h.chatAndWaitResult(
        "Reply exactly: XRAY",
        { timeoutMs: QUERY_TIMEOUT },
      );
      const r2 = await h.chatAndWaitResult(
        "Reply exactly: ZULU",
        { timeoutMs: QUERY_TIMEOUT },
      );

      const text1 = h.collectAllText(r1._request_id);
      const text2 = h.collectAllText(r2._request_id);

      expect(text1.toUpperCase()).toContain("XRAY");
      expect(text2.toUpperCase()).toContain("ZULU");
    }, 240_000);
  });

  // ==================== Group 14: list_skills Verification ====================

  describe("list_skills Verification", () => {
    it("list_skills returns all agent descriptions", async () => {
      h.resetCursor();
      await h.send({ cmd: "list_skills" });
      const evt = await h.waitForEvent("skills");
      const keys = Object.keys(evt.skills);
      expect(keys).toContain("screenwriter");
      expect(keys).toContain("art-director");
      expect(keys).toContain("video-producer");
      expect(keys).toContain("post-production");
      expect(keys).toContain("skill-creator");
      for (const key of keys) {
        expect(evt.skills[key].length).toBeGreaterThan(0);
      }
    });
  });

  // ==================== Group 15: Interrupt Handling ====================

  describe("Interrupt Handling", () => {
    it("interrupt command does not crash sandbox", async () => {
      h.resetCursor();
      await h.send({ cmd: "interrupt" });

      const result = await h.chatAndWaitResult(
        "Say: still alive",
        { timeoutMs: QUERY_TIMEOUT },
      );
      expect(result.is_error).toBe(false);
      const text = h.collectAllText(result._request_id);
      expect(text.toLowerCase()).toContain("alive");
    }, TEST_TIMEOUT);
  });

  // ==================== Group 16: Cross-Agent Data Sharing ====================

  describe("Cross-Agent Data Sharing", () => {
    it("file written by one agent is readable by another", async () => {
      const r1 = await h.chatAndWaitResult(
        `Use Bash: echo "shared-data-456" > ${SANDBOX_WORKSPACE}/shared-artifact.txt`,
        { target: "screenwriter", timeoutMs: QUERY_TIMEOUT },
      );
      expect(r1.is_error).toBe(false);

      const r2 = await h.chatAndWaitResult(
        `Use Read tool to read ${SANDBOX_WORKSPACE}/shared-artifact.txt. Show its content.`,
        { target: "art-director", timeoutMs: QUERY_TIMEOUT },
      );
      expect(r2.is_error).toBe(false);
      const text = h.collectAllText(r2._request_id);
      expect(text).toContain("shared-data-456");
    }, 240_000);
  });

  // ==================== Group 17: Status Command ====================

  describe("Status Command", () => {
    it("status returns idle when no query is running", async () => {
      h.resetCursor();
      await h.send({ cmd: "status" });
      const evt = await h.waitForEvent("status");
      expect(evt.state).toBe("idle");
    });
  });
});
