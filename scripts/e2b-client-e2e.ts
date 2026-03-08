/**
 * E2B SandboxClient E2E test
 *
 * Requires the "agentos-sandbox" custom template (built via `bun run build:e2b`).
 * Tests: create → ready → listSkills → status → chat(AI response) → destroy
 *
 * Usage: bun scripts/e2b-client-e2e.ts
 */
import fs from "node:fs";
import path from "node:path";
import { SandboxClient } from "../src/e2b-client.js";
import type { SandboxEvent } from "../src/protocol.js";

// ---------- .env ----------
// Parse .env into a separate map — needed to extract real values that
// process.env may shadow (e.g. Claude Code overrides ANTHROPIC_BASE_URL
// with its internal proxy, but the sandbox needs the actual PackyAPI URL).
const envPath = path.resolve(import.meta.dir, "../.env");
const dotenvMap: Record<string, string> = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    dotenvMap[k] = v;
    if (!(k in process.env)) process.env[k] = v;
  }
}

const API_KEY = process.env.E2B_API_KEY;
if (!API_KEY) {
  console.error("E2B_API_KEY not set");
  process.exit(1);
}

// ---------- Helpers ----------
const log = (m: string) => console.log(`[client-e2e] ${m}`);
const results: { name: string; pass: boolean }[] = [];

function assert(name: string, ok: boolean) {
  results.push({ name, pass: ok });
  log(ok ? `PASS: ${name}` : `FAIL: ${name}`);
}

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ---------- Main ----------
async function main() {
  const events: SandboxEvent[] = [];
  const stderrBuf: string[] = [];

  // Collect env vars to forward into sandbox (API keys needed by sandbox.ts).
  // Prefer .env values over process.env — Claude Code may override
  // ANTHROPIC_BASE_URL with its internal proxy (127.0.0.1:xxx).
  const FORWARD_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"];
  const envVars: Record<string, string> = {};
  for (const key of FORWARD_KEYS) {
    const val = dotenvMap[key] ?? process.env[key];
    if (val) envVars[key] = val;
  }

  log(`Forwarding env keys: ${Object.keys(envVars).join(", ") || "(none)"}`);

  log("Creating SandboxClient (template: agentos-sandbox)...");
  const client = new SandboxClient({
    templateId: "agentos-sandbox",
    apiKey: API_KEY,
    timeoutMs: 300_000,
    envs: envVars,
    onEvent: (ev) => {
      events.push(ev);
      log(`  << ${ev.type}: ${JSON.stringify(ev).slice(0, 120)}`);
    },
    onStderr: (data) => stderrBuf.push(data),
  });

  try {
    await client.start();
    log(`Sandbox: ${client.sandboxId}, PID: ${client.pid}`);

    // ---------- Test 1: ready event ----------
    const readyOk = await waitFor(
      () => events.some((e) => e.type === "ready"),
      30_000,
    );
    assert("ready event emitted on startup", readyOk);
    if (readyOk) {
      const ready = events.find((e) => e.type === "ready") as any;
      assert(
        "ready event contains skills array",
        Array.isArray(ready?.skills) && ready.skills.length > 0,
      );
    }

    // ---------- Test 2: list_skills ----------
    await client.listSkills();
    const skillsOk = await waitFor(
      () => events.some((e) => e.type === "skills"),
      5_000,
    );
    assert("list_skills -> skills event", skillsOk);
    if (skillsOk) {
      const sk = events.find((e) => e.type === "skills") as any;
      assert("skills map is non-empty", Object.keys(sk?.skills ?? {}).length > 0);
    }

    // ---------- Test 3: status (idle) ----------
    await client.status();
    const statusOk = await waitFor(
      () => events.some((e) => e.type === "status"),
      5_000,
    );
    assert("status -> status event", statusOk);
    if (statusOk) {
      const st = events.find((e) => e.type === "status") as any;
      assert("status.state === idle", st?.state === "idle");
    }

    // ---------- Test 4: invalid command ignored ----------
    const beforeCount = events.length;
    await client.sendCommand({ cmd: "nonexistent" } as any);
    await new Promise((r) => setTimeout(r, 1_000));
    assert("invalid command produces no crash", events.length === beforeCount);

    // ---------- Test 5: chat with AI response ----------
    const preChat = events.length;
    await client.chat('Reply with exactly: SANDBOX_OK');

    // Verify busy state
    await new Promise((r) => setTimeout(r, 300));
    await client.status();
    const busyOk = await waitFor(
      () =>
        events.slice(preChat).some(
          (e) => e.type === "status" && (e as any).state === "busy",
        ),
      5_000,
    );
    assert("chat triggers busy state", busyOk);

    // Wait for AI response — hard assertion
    const chatOk = await waitFor(
      () =>
        events.slice(preChat).some(
          (e) => e.type === "result" || e.type === "error",
        ),
      90_000,
    );
    assert("AI response received (result or error)", chatOk);

    if (chatOk) {
      const chatEvents = events.slice(preChat);
      const resultEv = chatEvents.find((e) => e.type === "result") as any;
      const errorEv = chatEvents.find((e) => e.type === "error") as any;

      if (resultEv) {
        log(`  Result: cost=$${resultEv.cost}, duration=${resultEv.duration_ms}ms`);
        assert("result event has session_id", !!resultEv.session_id);
        assert("result event is not error", !resultEv.is_error);
      } else if (errorEv) {
        log(`  Error: ${errorEv.message}`);
        assert("error event received (check API keys / network)", false);
      }
    }

    // ---------- Summary ----------
    log("\n========== E2E RESULTS ==========");
    for (const r of results) {
      log(`  ${r.pass ? "PASS" : "FAIL"} ${r.name}`);
    }
    const passed = results.filter((r) => r.pass).length;
    const total = results.length;
    log(`\n  ${passed}/${total} passed`);
    log(passed === total ? "\nALL E2E TESTS PASSED" : "\nSOME TESTS FAILED");

    return passed === total;
  } finally {
    log("Destroying sandbox...");
    await client.destroy();
  }
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
