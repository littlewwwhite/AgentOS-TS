// input: SandboxClient, .env (E2B_API_KEY + ANTHROPIC_API_KEY)
// output: End-to-end smoke test results for SandboxOrchestrator on E2B
// pos: Manual validation script — tests protocol commands including agent routing
//
// Pre-req: bun e2b/build.ts (template must be built)
// Usage: bun scripts/e2b-smoke.ts [--chat]
//   --chat  Run LLM chat tests (requires ANTHROPIC_API_KEY, costs ~$0.05)

import { SandboxClient } from "../src/e2b-client.js";
import type { SandboxEvent, SandboxCommand } from "../src/protocol.js";
import fs from "node:fs";
import path from "node:path";

// ---------- .env ----------
// Always prefer .env values over process.env for sandbox envs,
// because Claude Code sets ANTHROPIC_BASE_URL to a local proxy
// that is unreachable from inside the E2B sandbox.
const dotEnv: Record<string, string> = {};
const envPath = path.resolve(import.meta.dir, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    dotEnv[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}

if (!dotEnv.E2B_API_KEY && !process.env.E2B_API_KEY) {
  console.error("E2B_API_KEY not set");
  process.exit(1);
}

const RUN_CHAT = process.argv.includes("--chat");

// ---------- Helpers ----------
const log = (m: string) => console.log(`[e2b] ${m}`);
let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ---------- Client ----------
const events: SandboxEvent[] = [];
let cursor = 0; // watermark — search from here forward

const client = new SandboxClient({
  templateId: "agentos-sandbox",
  apiKey: dotEnv.E2B_API_KEY ?? process.env.E2B_API_KEY,
  onEvent: (event) => {
    events.push(event);
    log(`  << ${event.type} ${JSON.stringify(event).slice(0, 100)}`);
  },
  onStderr: (data) => console.error(`  [stderr] ${data.trim()}`),
  envs: {
    ANTHROPIC_API_KEY: dotEnv.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
    ANTHROPIC_BASE_URL: dotEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "",
  },
});

/** Search for event of given type starting from cursor */
async function waitForEvent(
  type: string,
  timeoutMs = 10000,
): Promise<SandboxEvent> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (let i = cursor; i < events.length; i++) {
      if (events[i].type === type) {
        cursor = i + 1; // advance past this event
        return events[i];
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout (${timeoutMs}ms) waiting for event: ${type}`);
}

/** Find event of given type from cursor without advancing */
function findEvent(type: string): SandboxEvent | null {
  for (let i = cursor; i < events.length; i++) {
    if (events[i].type === type) return events[i];
  }
  return null;
}

async function send(cmd: SandboxCommand) {
  await client.sendCommand(cmd);
}

async function test(name: string, fn: () => Promise<void>) {
  cursor = events.length; // new watermark
  process.stdout.write(`\n--- ${name} ---\n`);
  try {
    await fn();
    passed++;
    log(`PASS: ${name}`);
  } catch (err) {
    failed++;
    log(`FAIL: ${name} — ${err instanceof Error ? err.message : err}`);
  }
}

// ---------- Tests ----------
async function main() {
  log("Creating sandbox from template 'agentos-sandbox'...");
  await client.start();
  log(`Sandbox ID: ${client.sandboxId}`);

  // Wait for ready
  await waitForEvent("ready", 30000);
  log("Sandbox ready!");
  await new Promise((r) => setTimeout(r, 2000));
  log("Starting tests...\n");

  // --- Protocol tests (no LLM calls) ---

  await test("status returns idle", async () => {
    await send({ cmd: "status" });
    const evt = await waitForEvent("status");
    assert((evt as any).state === "idle", `state=${(evt as any).state}`);
  });

  await test("list_skills returns skills", async () => {
    await send({ cmd: "list_skills" });
    const evt = await waitForEvent("skills");
    const skills = (evt as any).skills;
    assert(typeof skills === "object" && skills !== null, "skills not object");
    const names = Object.keys(skills);
    assert(names.length > 0, "no skills loaded");
    log(`  Skills: ${names.join(", ")}`);
  });

  await test("enter_agent (screenwriter)", async () => {
    await send({ cmd: "enter_agent", agent: "screenwriter" });
    const evt = await waitForEvent("agent_entered");
    assert((evt as any).agent === "screenwriter", `agent=${(evt as any).agent}`);
  });

  await test("status after enter_agent shows busy=false", async () => {
    await send({ cmd: "status" });
    const evt = await waitForEvent("status");
    assert((evt as any).state === "idle", `state=${(evt as any).state}`);
  });

  await test("exit_agent", async () => {
    await send({ cmd: "exit_agent" });
    const evt = await waitForEvent("agent_exited");
  });

  await test("exit_agent when not in agent returns error", async () => {
    await send({ cmd: "exit_agent" });
    const evt = await waitForEvent("error");
    assert((evt as any).message.includes("Not in"), (evt as any).message);
  });

  await test("enter_agent with invalid name returns error", async () => {
    await send({ cmd: "enter_agent", agent: "nonexistent-agent-xyz" });
    const evt = await waitForEvent("error");
    assert(
      (evt as any).message.includes("not found") ||
        (evt as any).message.includes("Unknown"),
      (evt as any).message,
    );
  });

  // --- LLM chat tests (optional, costs money) ---

  if (RUN_CHAT) {
    if (!dotEnv.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      log("SKIP: chat tests require ANTHROPIC_API_KEY");
    } else {
      await test("chat (main session)", async () => {
        await send({
          cmd: "chat",
          message: "Reply with exactly one word: pong",
          request_id: "smoke-main",
        });
        const evt = await waitForEvent("result", 30000);
        assert(!(evt as any).is_error, "query returned error");
        log(
          `  Cost: $${(evt as any).cost}, session: ${(evt as any).session_id}`,
        );
      });

      await test("chat with target=screenwriter", async () => {
        await send({
          cmd: "chat",
          message: "Reply with exactly one word: pong",
          target: "screenwriter",
          request_id: "smoke-target",
        });
        const result = await waitForEvent("result", 30000);
        assert(!(result as any).is_error, "query returned error");
        // Check for agent correlation in text events
        const textEvt = findEvent("text");
        if (textEvt && (textEvt as any).agent === "screenwriter") {
          log("  Agent correlation: yes");
        }
        log(`  Cost: $${(result as any).cost}`);
      });

      await test("enter_agent + chat + exit_agent", async () => {
        await send({ cmd: "enter_agent", agent: "screenwriter" });
        await waitForEvent("agent_entered");

        await send({
          cmd: "chat",
          message: "Reply with exactly one word: active",
          request_id: "smoke-entered",
        });
        const result = await waitForEvent("result", 30000);
        assert(!(result as any).is_error, "query returned error");
        log(`  Cost: $${(result as any).cost}`);

        await send({ cmd: "exit_agent" });
        await waitForEvent("agent_exited");
      });
    }
  } else {
    log("\nSKIP: chat tests (use --chat to enable, costs ~$0.05)");
  }

  // --- Summary ---
  console.log(`\n${"=".repeat(40)}`);
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log(`${"=".repeat(40)}`);

  await client.destroy();
  log("Sandbox destroyed.");
  return failed === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch(async (e) => {
    console.error("Fatal:", e);
    await client.destroy().catch(() => {});
    process.exit(1);
  });
