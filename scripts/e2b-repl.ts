// input: SandboxClient, .env, terminal stdin
// output: Interactive REPL session over E2B sandbox with upload/download file sync
// pos: Primary E2B entry — terminal interface for agent running in E2B sandbox
//
// Usage: bun scripts/e2b-repl.ts [--sandbox <id>] [--workspace <path>] [--restore-workspace]

import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { SandboxClient } from "../src/e2b-client.js";
import {
  computeTemplateInputFingerprint,
  decideTemplateBuildOnStart,
  readTemplateBuildState,
} from "../src/e2b-template-state.js";
import { parseE2BReplCliArgs, shouldRestoreWorkspaceOnStart } from "../src/e2b-repl-cli.js";
import { renderSandboxEvent } from "../src/e2b-repl-render.js";
import { applyReplEvent, createInitialReplState } from "../src/e2b-repl-state.js";
import { loadDotEnv } from "../src/env.js";
import type { SandboxEvent } from "../src/protocol.js";
import { matchEnterAgent } from "../src/protocol.js";

// ---------- CLI args ----------

const cliArgs = parseE2BReplCliArgs(process.argv.slice(2));
const { connectSandboxId, localWorkspaceOverride, restoreWorkspaceOnStart } = cliArgs;

// ---------- .env ----------

const dotEnv = loadDotEnv(path.resolve(import.meta.dir, "../.env"));

const E2B_KEY = dotEnv.E2B_API_KEY ?? process.env.E2B_API_KEY;
if (!E2B_KEY) {
  console.error("E2B_API_KEY not set in .env or environment");
  process.exit(1);
}

// ---------- ANSI helpers ----------

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

// ---------- Constants ----------

const SLASH_COMMANDS = [
  "/enter",
  "/exit",
  "/agents",
  "/skills",
  "/status",
  "/ls",
  "/cat",
  "/upload",
  "/download",
  "/sync",
  "/destroy",
  "/help",
];

const EXIT_RE = /^(?:退出|返回|exit|back|go\s+back)$/i;

const SANDBOX_WORKSPACE = "/home/user/app/workspace";
const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const LOCAL_WORKSPACE = localWorkspaceOverride
  ? path.resolve(localWorkspaceOverride)
  : path.resolve(import.meta.dir, "../workspace");

// ---------- State ----------

let agentNames: string[] = [];
let replState = createInitialReplState();

// ---------- Event handler ----------

function handleEvent(event: SandboxEvent): void {
  const rendered = renderSandboxEvent(replState, event, {
    dim,
    cyan,
    yellow,
    red,
  });
  replState = rendered.state;
  for (const chunk of rendered.output) {
    process.stdout.write(chunk);
  }

  switch (event.type) {
    case "ready":
      agentNames = event.skills ?? [];
      break;

    case "skills": {
      break;
    }

    // Only update state from events — REPL handles its own visual feedback
    // to avoid race conditions with the readline prompt
    case "agent_entered":
    case "agent_exited": {
      const next = applyReplEvent(replState, event);
      replState = next.state;
      for (const line of next.logs) {
        console.log(cyan(line));
      }
      break;
    }

    case "text":
    case "thinking":
    case "tool_use":
    case "tool_log":
    case "result":
    case "error":
    case "status":
    case "system":
    case "history":
      break;
  }
}

// ---------- Tab completion ----------

function completer(line: string): [string[], string] {
  if (line.startsWith("/")) {
    const hits = SLASH_COMMANDS.filter((c) => c.startsWith(line));
    return [hits.length ? hits : SLASH_COMMANDS, line];
  }
  return [[], line];
}

function runLocalCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`Command exited from signal ${signal}`));
        return;
      }
      reject(new Error(`Command exited with code ${code ?? "unknown"}`));
    });
  });
}

async function ensureTemplateIsCurrent(connectSandboxId: string | null): Promise<void> {
  const currentFingerprint = await computeTemplateInputFingerprint(PROJECT_ROOT);
  const savedState = await readTemplateBuildState(PROJECT_ROOT);
  const decision = decideTemplateBuildOnStart({
    connectSandboxId,
    currentFingerprint,
    savedFingerprint: savedState?.fingerprint ?? null,
  });

  if (!decision.shouldBuild) {
    return;
  }

  if (decision.reason === "missing_state") {
    console.log(dim("  No local E2B template build state found."));
  } else {
    console.log(dim("  Local E2B template inputs changed since the last build."));
  }
  console.log(dim("  Rebuilding E2B template..."));
  await runLocalCommand(["run", "build:e2b"]);
}

// ---------- Main ----------

async function main() {
  console.log(`\n  ${bold("AgentOS")} ${dim("v0.1.0")} ${yellow("(E2B sandbox)")}`);

  const client = new SandboxClient({
    templateId: "agentos-sandbox",
    apiKey: E2B_KEY,
    timeoutMs: 300_000,
    envs: {
      ANTHROPIC_API_KEY: dotEnv.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
      ANTHROPIC_BASE_URL: dotEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "",
    },
    onEvent: handleEvent,
    onStderr: (data) => {
      const trimmed = data.trim();
      if (trimmed) process.stderr.write(`${dim(`  [stderr] ${trimmed}`)}\n`);
    },
  });

  // -- Start or reconnect --
  if (connectSandboxId) {
    console.log(dim(`  Connecting to sandbox ${connectSandboxId}...`));
    try {
      await client.connect(connectSandboxId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(yellow(`  ⚠ Could not reconnect: ${msg}`));
      console.log(dim("  Creating new sandbox..."));
      await ensureTemplateIsCurrent(null);
      await client.start();
    }
  } else {
    console.log(dim("  Creating sandbox..."));
    await ensureTemplateIsCurrent(null);
    await client.start();
  }
  console.log(dim(`  Sandbox: ${client.sandboxId}`));

  // -- Restore local workspace into sandbox --
  if (
    shouldRestoreWorkspaceOnStart({
      connectSandboxId,
      restoreWorkspaceOnStart,
      localWorkspaceExists: fs.existsSync(LOCAL_WORKSPACE),
    })
  ) {
    console.log(dim("  Syncing workspace → sandbox..."));
    try {
      const synced = await client.syncDir(LOCAL_WORKSPACE, SANDBOX_WORKSPACE);
      if (synced.length > 0) {
        console.log(green(`  ✓ Restored ${synced.length} files → sandbox`));
      }
    } catch (err) {
      console.log(
        red(`  ✗ Workspace restore failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  // Wait for ready
  const t0 = Date.now();
  while (agentNames.length === 0 && Date.now() - t0 < 60_000) {
    await new Promise((r) => setTimeout(r, 200));
  }

  if (agentNames.length > 0) {
    console.log(dim("  Agents:"));
    for (const name of agentNames) {
      console.log(`    ${cyan(name)}`);
    }
  }

  console.log(
    dim(
      "  Ctrl+C · interrupt    Ctrl+C x 2 · disconnect (sandbox stays alive)    /destroy · kill sandbox\n",
    ),
  );

  // ---------- REPL ----------

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });

  const ask = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const label = replState.activeAgent ?? "main";
      const prompt = cyan(`\n${label} ❯ `);
      rl.question(prompt, (a) => (a === undefined ? reject(new Error("EOF")) : resolve(a)));
    });

  // -- Graceful exit: sync workspace, disconnect (sandbox stays alive for reconnect) --
  const syncAndDisconnect = async () => {
    console.log(dim("\n  Syncing workspace ← sandbox..."));
    try {
      const pulled = await client.pullDir(SANDBOX_WORKSPACE, LOCAL_WORKSPACE);
      if (pulled.length > 0) {
        console.log(green(`  ✓ Saved ${pulled.length} files ← sandbox`));
      } else {
        console.log(dim("  (no files to sync)"));
      }
    } catch (err) {
      console.log(red(`  ✗ Sync failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    const id = client.sandboxId;
    await client.disconnect();
    console.log(dim(`  Disconnected. Sandbox ${id} is still alive.`));
    console.log(dim(`  Reconnect: bun scripts/e2b-repl.ts --sandbox ${id}`));
  };

  let ctrlC = 0;
  process.on("SIGINT", () => {
    if (replState.busy) {
      client.interrupt().catch(() => {});
      console.log(dim("\n  Interrupting..."));
      ctrlC = 0;
      return;
    }
    if (++ctrlC >= 2) {
      syncAndDisconnect()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
      return;
    }
    console.log(dim("\n  Press Ctrl+C again to exit, or keep typing."));
  });

  while (true) {
    let input: string;
    try {
      input = (await ask()).trim();
      ctrlC = 0;
    } catch {
      break;
    }
    if (!input) continue;

    // Slash commands
    if (input.startsWith("/")) {
      const parts = input.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      if (cmd === "/enter") {
        const name = parts[1];
        if (!name) {
          console.log(dim("  Usage: /enter <agent-name>"));
        } else {
          // Set eagerly — don't wait for async event (fixes prompt race)
          replState = { ...replState, activeAgent: name };
          console.log(`  ${cyan("⏺")} entered ${bold(name)}`);
          await client.sendCommand({ cmd: "enter_agent", agent: name });
        }
        continue;
      }

      if (cmd === "/exit") {
        if (!replState.activeAgent) {
          console.log(dim("  Not in an agent session"));
        } else {
          const exited = replState.activeAgent;
          replState = { ...replState, activeAgent: null };
          console.log(`  ${dim("⏺")} exited ${exited}`);
          await client.sendCommand({ cmd: "exit_agent" });
        }
        continue;
      }

      if (cmd === "/agents" || cmd === "/skills") {
        await client.listSkills();
        continue;
      }

      if (cmd === "/status") {
        await client.status();
        continue;
      }

      // -- Sandbox file operations --

      if (cmd === "/ls") {
        const target = parts[1] ?? "/home/user/app/workspace";
        try {
          const entries = await client.listFiles(target);
          if (entries.length === 0) {
            console.log(dim("  (empty)"));
          } else {
            for (const e of entries) {
              const icon = e.type === "dir" ? "📁" : "  ";
              console.log(`  ${icon} ${e.name}`);
            }
          }
        } catch (err) {
          console.log(red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
        }
        continue;
      }

      if (cmd === "/cat") {
        const filePath = parts[1];
        if (!filePath) {
          console.log(dim("  Usage: /cat <path>"));
        } else {
          try {
            const content = await client.readFile(filePath);
            console.log(content);
          } catch (err) {
            console.log(red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
          }
        }
        continue;
      }

      if (cmd === "/upload") {
        const localPath = parts[1];
        if (!localPath) {
          console.log(dim("  Usage: /upload <local-path> [remote-path]"));
          console.log(dim("  If local-path is a directory, syncs recursively."));
        } else {
          const stat = fs.statSync(localPath, { throwIfNoEntry: false });
          if (!stat) {
            console.log(red(`  ✗ ${localPath} does not exist`));
          } else if (stat.isDirectory()) {
            const remotePath = parts[2] ?? "/home/user/app/workspace/data";
            try {
              const uploaded = await client.syncDir(localPath, remotePath);
              console.log(green(`  ✓ Synced ${uploaded.length} files → ${remotePath}`));
              for (const f of uploaded) {
                console.log(dim(`    ${f}`));
              }
            } catch (err) {
              console.log(red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
            }
          } else {
            const remotePath = parts[2] ?? `/home/user/app/workspace/${path.basename(localPath)}`;
            try {
              const content = fs.readFileSync(localPath, "utf-8");
              await client.writeFile(remotePath, content);
              console.log(green(`  ✓ ${localPath} → ${remotePath}`));
            } catch (err) {
              console.log(red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
            }
          }
        }
        continue;
      }

      if (cmd === "/download") {
        const remotePath = parts[1];
        if (!remotePath) {
          console.log(dim("  Usage: /download <remote-path> [local-path]"));
        } else {
          const localPath = parts[2] ?? path.basename(remotePath);
          try {
            const content = await client.readFile(remotePath);
            fs.writeFileSync(localPath, content);
            console.log(green(`  ✓ ${remotePath} → ${localPath}`));
          } catch (err) {
            console.log(red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
          }
        }
        continue;
      }

      if (cmd === "/sync") {
        console.log(dim("  Pulling workspace ← sandbox..."));
        try {
          const pulled = await client.pullDir(SANDBOX_WORKSPACE, LOCAL_WORKSPACE);
          if (pulled.length > 0) {
            console.log(green(`  ✓ Synced ${pulled.length} files`));
            for (const f of pulled) {
              console.log(dim(`    ${f}`));
            }
          } else {
            console.log(dim("  (no files to sync)"));
          }
        } catch (err) {
          console.log(red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
        }
        continue;
      }

      if (cmd === "/destroy") {
        console.log(dim("  Syncing workspace ← sandbox..."));
        try {
          const pulled = await client.pullDir(SANDBOX_WORKSPACE, LOCAL_WORKSPACE);
          if (pulled.length > 0) console.log(green(`  ✓ Saved ${pulled.length} files`));
        } catch {
          /* best-effort */
        }
        console.log(dim("  Destroying sandbox..."));
        await client.destroy();
        console.log(dim("  Sandbox destroyed. Goodbye."));
        rl.close();
        process.exit(0);
      }

      if (cmd === "/help" || cmd === "/") {
        if (replState.activeAgent) {
          console.log(dim("  Current agent: ") + cyan(bold(replState.activeAgent)));
        } else {
          console.log(dim("  Current: orchestrator (no active agent)"));
        }
        console.log(dim(`  Sandbox: ${client.sandboxId}`));
        console.log(dim(`  Local workspace: ${LOCAL_WORKSPACE}`));
        console.log(dim("  Commands:"));
        console.log(`    ${cyan("/enter <agent>")}  ${dim("switch to agent session")}`);
        console.log(`    ${cyan("/exit")}           ${dim("return to orchestrator")}`);
        console.log(`    ${cyan("/agents")}         ${dim("list available agents")}`);
        console.log(`    ${cyan("/status")}         ${dim("check sandbox status")}`);
        console.log(`    ${cyan("/ls [path]")}      ${dim("list sandbox files")}`);
        console.log(`    ${cyan("/cat <path>")}     ${dim("read sandbox file")}`);
        console.log(`    ${cyan("/upload <l> [r]")} ${dim("upload local file/dir to sandbox")}`);
        console.log(`    ${cyan("/download <r> [l]")} ${dim("download sandbox file to local")}`);
        console.log(`    ${cyan("/sync")}           ${dim("pull sandbox workspace to local")}`);
        console.log(`    ${cyan("/destroy")}        ${dim("sync + permanently kill sandbox")}`);
        console.log(`    ${cyan("/help")}           ${dim("show this help")}`);
        continue;
      }
    }

    // Natural language agent entry (e.g. "进入screenwriter", "switch to editor")
    const nlAgent = matchEnterAgent(input, agentNames);
    if (nlAgent) {
      replState = { ...replState, activeAgent: nlAgent };
      console.log(`  ${cyan("⏺")} entered ${bold(nlAgent)}`);
      await client.sendCommand({ cmd: "enter_agent", agent: nlAgent });
      continue;
    }

    // Natural language exit (e.g. "退出", "返回", "exit", "back")
    if (replState.activeAgent && EXIT_RE.test(input)) {
      const exited = replState.activeAgent;
      replState = { ...replState, activeAgent: null };
      console.log(`  ${dim("⏺")} exited ${exited}`);
      await client.sendCommand({ cmd: "exit_agent" });
      continue;
    }

    // Chat
    replState = { ...replState, busy: true };
    await client.chat(input);

    // Wait for result before showing next prompt
    while (replState.busy) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  await syncAndDisconnect();
  rl.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
