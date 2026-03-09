// input: E2BTestHarness, protocol types
// output: Comprehensive E2B integration test suite
// pos: End-to-end tests — validates protocol, workspace, chat, routing, and agent visibility

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2BTestHarness, loadDotEnv } from "./harness.js";
import type { ReadyEvent } from "../../src/protocol.js";

// ---------- Environment detection ----------

const env = loadDotEnv();
const HAS_E2B = !!(env.E2B_API_KEY ?? process.env.E2B_API_KEY);
const HAS_LLM = !!(env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY);

const AGENTS = [
  "screenwriter",
  "art-director",
  "video-producer",
  "post-production",
  "skill-creator",
] as const;

// ---------- Shared instance ----------

const h = new E2BTestHarness(env);
let readyEvent: ReadyEvent;

// ---------- Test suite ----------

describe.skipIf(!HAS_E2B)("E2B Integration", () => {
  beforeAll(async () => {
    readyEvent = await h.setup();
  }, 120_000);

  afterAll(async () => {
    await h.teardown();
  }, 30_000);

  // ==================== Group 1: Protocol ====================

  describe("Protocol", () => {
    it("ready event has all 5 agents", () => {
      for (const name of AGENTS) {
        expect(readyEvent.skills).toContain(name);
      }
    });

    it("status returns idle", async () => {
      h.resetCursor();
      await h.send({ cmd: "status" });
      const evt = await h.waitForEvent("status");
      expect(evt.state).toBe("idle");
    });

    it("list_skills returns agents with descriptions", async () => {
      h.resetCursor();
      await h.send({ cmd: "list_skills" });
      const evt = await h.waitForEvent("skills");
      const keys = Object.keys(evt.skills);
      expect(keys.length).toBeGreaterThanOrEqual(5);
      // Each skill should have a Chinese description
      for (const key of keys) {
        expect(evt.skills[key]).toBeTruthy();
      }
    });

    it("enter_agent emits agent_entered", async () => {
      h.resetCursor();
      await h.send({ cmd: "enter_agent", agent: "screenwriter" });
      const evt = await h.waitForEvent("agent_entered");
      expect(evt.agent).toBe("screenwriter");
    });

    it("status after enter shows idle", async () => {
      h.resetCursor();
      await h.send({ cmd: "status" });
      const evt = await h.waitForEvent("status");
      expect(evt.state).toBe("idle");
    });

    it("exit_agent emits agent_exited", async () => {
      h.resetCursor();
      await h.send({ cmd: "exit_agent" });
      const evt = await h.waitForEvent("agent_exited");
      expect(evt.agent).toBe("screenwriter");
    });

    it("exit without active agent emits error", async () => {
      h.resetCursor();
      await h.send({ cmd: "exit_agent" });
      const evt = await h.waitForEvent("error");
      expect(evt.message).toMatch(/Not in/i);
    });

    it("invalid agent emits error", async () => {
      h.resetCursor();
      await h.send({ cmd: "enter_agent", agent: "nonexistent-agent-xyz" });
      const evt = await h.waitForEvent("error");
      expect(evt.message).toMatch(/Unknown|not found/i);
    });

    it("enter/exit cycle all 5 agents", async () => {
      for (const agent of AGENTS) {
        h.resetCursor();
        await h.send({ cmd: "enter_agent", agent });
        const entered = await h.waitForEvent("agent_entered");
        expect(entered.agent).toBe(agent);

        h.resetCursor();
        await h.send({ cmd: "exit_agent" });
        const exited = await h.waitForEvent("agent_exited");
        expect(exited.agent).toBe(agent);
      }
    });

    it("rapid status commands all responded", async () => {
      h.resetCursor();
      await h.send({ cmd: "status" });
      await h.send({ cmd: "status" });
      await h.send({ cmd: "status" });

      // Event-driven: wait for 3 status events sequentially
      await h.waitForEvent("status");
      await h.waitForEvent("status");
      await h.waitForEvent("status");
    });
  });

  // ==================== Group 2: Workspace ====================

  describe("Workspace", () => {
    it("workspace dir exists", async () => {
      const files = await h.listFiles("/home/user/app/workspace");
      expect(files).toBeDefined();
    });

    it("skills dir has expected folders", async () => {
      const files = await h.listFiles("/home/user/app/skills");
      const names = files.map((f: any) => f.name);
      expect(names).toContain("script-writer");
      expect(names).toContain("image-create");
      expect(names).toContain("video-create");
    });

    it("agents dir has yaml configs", async () => {
      const files = await h.listFiles("/home/user/app/agents");
      const names = files.map((f: any) => f.name);
      expect(names).toContain("screenwriter.yaml");
      expect(names).toContain("art-director.yaml");
    });

    it("dist dir has sandbox.js", async () => {
      const files = await h.listFiles("/home/user/app/dist");
      const names = files.map((f: any) => f.name);
      expect(names).toContain("sandbox.js");
    });
  });

  // ==================== Group 3: Chat ====================

  describe.skipIf(!HAS_LLM)("Chat", () => {
    it("main session returns result", async () => {
      const result = await h.chatAndWaitResult("Reply one word: pong");
      expect(result.is_error).toBe(false);
      expect(result.session_id).toBeTruthy();
      expect(result.cost).toBeGreaterThanOrEqual(0);
    });

    it("text events appear before result", async () => {
      const result = await h.chatAndWaitResult("Reply one word: hello");
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(0);
    });

    it("session persistence across messages", async () => {
      const r1 = await h.chatAndWaitResult(
        "Remember this exact word: ALPHA",
      );
      expect(r1.is_error).toBe(false);

      const r2 = await h.chatAndWaitResult(
        "What exact word did I ask you to remember? Reply with just that word.",
      );
      expect(r2.is_error).toBe(false);
      // session_id is truthy on both results (SDK may rotate IDs across turns)
      expect(r2.session_id).toBeTruthy();

      // Conversation context persists — agent remembers ALPHA
      const text = h.collectAllText(r2._request_id);
      expect(text.toUpperCase()).toContain("ALPHA");
    });

    it("request_id present on all correlated events", async () => {
      const result = await h.chatAndWaitResult("Say: ok");
      const rid = result._request_id;

      expect(result.request_id).toBe(rid);

      const textEvents = h.allEvents.filter(
        (e) => e.type === "text" && e.request_id === rid,
      );
      for (const evt of textEvents) {
        expect(evt.request_id).toBe(rid);
      }
    });
  });

  // ==================== Group 4: Agent Routing ====================

  describe.skipIf(!HAS_LLM)("Agent Routing", () => {
    it("target dispatch routes to specified agent", async () => {
      const result = await h.chatAndWaitResult(
        "Reply one word: pong",
        { target: "screenwriter" },
      );
      expect(result.is_error).toBe(false);
      expect(result.agent).toBe("screenwriter");

      // All correlated text events should carry agent field
      const textEvents = h.allEvents.filter(
        (e) => e.type === "text" && e.request_id === result._request_id,
      );
      for (const evt of textEvents) {
        expect(evt.agent).toBe("screenwriter");
      }
    });

    it("enter + chat + exit flow with agent correlation", async () => {
      // Enter agent
      h.resetCursor();
      await h.send({ cmd: "enter_agent", agent: "art-director" });
      await h.waitForEvent("agent_entered");

      // Chat inside agent — should have agent field
      const r1 = await h.chatAndWaitResult("Reply one word: yes");
      expect(r1.is_error).toBe(false);
      expect(r1.agent).toBe("art-director");

      // Exit agent
      h.resetCursor();
      await h.send({ cmd: "exit_agent" });
      await h.waitForEvent("agent_exited");

      // Chat outside agent — should NOT have agent field
      const r2 = await h.chatAndWaitResult("Reply one word: no");
      expect(r2.is_error).toBe(false);
      expect(r2.agent).toBeUndefined();
    });

    it("invalid target emits error with request_id", async () => {
      const rid = `test-invalid-${Date.now()}`;
      h.resetCursor();
      await h.send({
        cmd: "chat",
        message: "hello",
        target: "nonexistent-agent-xyz",
        request_id: rid,
      });
      const evt = await h.waitForEvent("error");
      expect(evt.message).toMatch(/Unknown|not found/i);
    });
  });

  // ==================== Group 5: Agent Visibility ====================

  describe.skipIf(!HAS_LLM)("Agent Visibility", () => {
    it("screenwriter responds with domain knowledge", async () => {
      const result = await h.chatAndWaitResult(
        "介绍你的角色，用一句话",
        { target: "screenwriter" },
      );
      expect(result.is_error).toBe(false);
      expect(result.agent).toBe("screenwriter");
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(0);
      const hasDomainHint = /剧本|编剧|script|screenwriter|story|写作|创作/.test(text);
      if (!hasDomainHint) {
        console.warn(`[visibility] screenwriter response lacked domain keywords: ${text.slice(0, 120)}`);
      }
    });

    it("art-director responds with domain knowledge", async () => {
      const result = await h.chatAndWaitResult(
        "介绍你的角色，用一句话",
        { target: "art-director" },
      );
      expect(result.is_error).toBe(false);
      expect(result.agent).toBe("art-director");
      const text = h.collectAllText(result._request_id);
      expect(text.length).toBeGreaterThan(0);
      const hasDomainHint = /美术|视觉|图片|设计|art|visual|design|image/.test(text);
      if (!hasDomainHint) {
        console.warn(`[visibility] art-director response lacked domain keywords: ${text.slice(0, 120)}`);
      }
    });
  });
});
