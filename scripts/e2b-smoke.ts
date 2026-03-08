/**
 * E2B end-to-end integration test
 *
 * Pre-req: bun run build (dist/ must exist)
 * Usage: bun scripts/e2b-smoke.ts
 *
 * Tests the full sandbox protocol chain:
 * 1. Create E2B sandbox
 * 2. Upload project bundle + install deps
 * 3. Start sandbox.js process (background + stdin)
 * 4. Verify ready / list_skills / status events
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Sandbox } from "e2b";

// ---------- .env ----------
const envPath = path.resolve(import.meta.dir, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

const API_KEY = process.env.E2B_API_KEY;
if (!API_KEY) {
  console.error("E2B_API_KEY not set");
  process.exit(1);
}

// ---------- Helpers ----------
type Ev = Record<string, unknown>;
const log = (m: string) => console.log(`[e2b] ${m}`);

async function waitFor(
  pred: () => boolean,
  ms: number,
): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// ---------- Main ----------
async function main() {
  // 0. Build bundle
  log("Building tar bundle...");
  execSync("bun run build", { stdio: "inherit" });
  execSync(
    "tar czf /tmp/agentos-lite.tar.gz dist/ skills/ package.json bun.lock",
    { stdio: "inherit" },
  );
  const bundle = fs.readFileSync("/tmp/agentos-lite.tar.gz");
  log(`Bundle size: ${(bundle.length / 1024).toFixed(0)} KB`);

  // 1. Create sandbox (5 min timeout)
  log("Creating sandbox...");
  const sandbox = await Sandbox.create({
    apiKey: API_KEY,
    timeoutMs: 300_000,
  });
  log(`Sandbox: ${sandbox.sandboxId}`);

  try {
    // 2. Install bun
    log("Installing bun in sandbox...");
    const bunInstall = await sandbox.commands.run(
      "curl -fsSL https://bun.sh/install | bash 2>&1",
      { timeoutMs: 60_000 },
    );
    if (bunInstall.exitCode !== 0) throw new Error("bun install failed");
    log("bun installed");

    // 3. Upload + extract bundle
    const APP = "/home/user/app";
    log("Uploading bundle...");
    await sandbox.files.write("/tmp/bundle.tar.gz", bundle);
    const extract = await sandbox.commands.run(
      `mkdir -p ${APP} && cd ${APP} && tar xzf /tmp/bundle.tar.gz`,
      { timeoutMs: 10_000 },
    );
    if (extract.exitCode !== 0) throw new Error("extract failed");
    log("Bundle extracted");

    // 4. Install node dependencies
    log("Installing dependencies...");
    const deps = await sandbox.commands.run(
      `cd ${APP} && /home/user/.bun/bin/bun install --frozen-lockfile 2>&1`,
      { timeoutMs: 60_000 },
    );
    log(`bun install exit: ${deps.exitCode}`);
    if (deps.exitCode !== 0) {
      log(`stdout: ${deps.stdout.slice(0, 500)}`);
      throw new Error("bun install failed");
    }

    // 5. Create workspace
    await sandbox.commands.run(`mkdir -p ${APP}/workspace`);

    // 6. Start sandbox process
    log("Starting sandbox process...");
    const events: Ev[] = [];
    const stderr: string[] = [];

    const cmd = await sandbox.commands.run(
      `/home/user/.bun/bin/bun ${APP}/dist/sandbox.js ${APP}/workspace --skills ${APP}/skills`,
      {
        background: true,
        stdin: true,
        cwd: APP,
        onStdout: (data: string) => {
          for (const line of data.split("\n").filter((l) => l.trim())) {
            try {
              const ev = JSON.parse(line);
              events.push(ev);
              log(`  << ${JSON.stringify(ev).slice(0, 120)}`);
            } catch {
              log(`  [raw] ${line.slice(0, 80)}`);
            }
          }
        },
        onStderr: (data: string) => stderr.push(data),
      },
    );
    log(`PID: ${cmd.pid}`);

    // 7. Test: ready event
    log("Waiting for ready...");
    const readyOk = await waitFor(
      () => events.some((e) => e.type === "ready"),
      20_000,
    );
    if (!readyOk) {
      log("FAIL: no ready event");
      log(`stderr: ${stderr.join("").slice(0, 500)}`);
      return false;
    }
    log("PASS: ready");

    // 8. Test: list_skills
    log("Testing list_skills...");
    await sandbox.commands.sendStdin(cmd.pid, '{"cmd":"list_skills"}\n');
    const skillsOk = await waitFor(
      () => events.some((e) => e.type === "skills"),
      5_000,
    );
    log(skillsOk ? "PASS: skills" : "FAIL: skills");

    // 9. Test: status
    log("Testing status...");
    await sandbox.commands.sendStdin(cmd.pid, '{"cmd":"status"}\n');
    const statusOk = await waitFor(
      () => events.some((e) => e.type === "status"),
      5_000,
    );
    log(statusOk ? "PASS: status" : "FAIL: status");

    await cmd.kill().catch(() => {});

    const allPassed = readyOk && skillsOk && statusOk;
    log(allPassed ? "\nALL E2B TESTS PASSED" : "\nSOME TESTS FAILED");
    return allPassed;
  } finally {
    log("Destroying sandbox...");
    await sandbox.kill().catch(() => {});
  }
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
