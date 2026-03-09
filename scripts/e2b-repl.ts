// input: SandboxClient, .env, terminal stdin
// output: Interactive REPL session over E2B sandbox
// pos: Primary E2B entry — terminal interface for agent running in E2B sandbox
//
// Usage: bun scripts/e2b-repl.ts

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { SandboxClient } from "../src/e2b-client.js";
import type { SandboxEvent } from "../src/protocol.js";
import { matchEnterAgent } from "../src/protocol.js";
import { loadDotEnv } from "../src/env.js";

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
  "/enter", "/exit", "/agents", "/skills", "/status",
  "/ls", "/cat", "/download", "/help",
];

const EXIT_RE = /^(?:退出|返回|exit|back|go\s+back)$/i;

// ---------- State ----------

let activeAgent: string | null = null;
let agentNames: string[] = [];
let busy = false;
let textStarted = false;

// ---------- Event handler ----------

function handleEvent(event: SandboxEvent): void {
  switch (event.type) {
    case "ready":
      agentNames = event.skills ?? [];
      break;

    case "text": {
      if (!textStarted) {
        const label = event.agent ?? "main";
        process.stdout.write(dim(`[${label}] `));
      }
      textStarted = true;
      process.stdout.write(event.text);
      break;
    }

    case "tool_use":
      console.log(dim(`  ⚡ ${event.tool}`));
      break;

    case "tool_log":
      if (event.phase === "post" && event.detail) {
        const summary = JSON.stringify(event.detail).slice(0, 120);
        console.log(dim(`    ⎿ ${summary}`));
      }
      break;

    case "result": {
      busy = false;
      textStarted = false;
      const cost = `$${event.cost.toFixed(4)}`;
      const dur = `${(event.duration_ms / 1000).toFixed(1)}s`;
      console.log(`\n${dim(`  ─ ${cost} · ${dur}`)}`);
      break;
    }

    case "error":
      console.log(red(`  ✗ ${event.message}`));
      busy = false;
      textStarted = false;
      break;

    case "status":
      busy = event.state === "busy";
      break;

    case "skills": {
      console.log(dim("  Skills:"));
      for (const [name, desc] of Object.entries(event.skills)) {
        const short = desc.length > 60 ? desc.slice(0, 60) + "…" : desc;
        console.log(`    ${cyan(name.padEnd(18))} ${dim(short)}`);
      }
      break;
    }

    // Only update state from events — REPL handles its own visual feedback
    // to avoid race conditions with the readline prompt
    case "agent_entered":
      activeAgent = event.agent;
      break;

    case "agent_exited":
      activeAgent = null;
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

// ---------- Main ----------

async function main() {
  console.log(`\n  ${bold("AgentOS")} ${dim("v0.1.0")} ${yellow("(E2B sandbox)")}`);
  console.log(dim("  Creating sandbox..."));

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
      if (trimmed) process.stderr.write(dim(`  [stderr] ${trimmed}`) + "\n");
    },
  });

  await client.start();
  console.log(dim(`  Sandbox: ${client.sandboxId}`));

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

  console.log(dim("  Ctrl+C · interrupt    Ctrl+C x 2 · exit    /enter <agent> · direct mode\n"));

  // ---------- REPL ----------

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });

  const ask = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const label = activeAgent ?? "main";
      const prompt = cyan(`\n${label} ❯ `);
      rl.question(prompt, (a) =>
        a === undefined ? reject(new Error("EOF")) : resolve(a),
      );
    });

  let ctrlC = 0;
  process.on("SIGINT", () => {
    if (busy) {
      client.interrupt().catch(() => {});
      console.log(dim("\n  Interrupting..."));
      ctrlC = 0;
      return;
    }
    if (++ctrlC >= 2) {
      console.log(dim("\n  Destroying sandbox..."));
      client.destroy().then(() => process.exit(0)).catch(() => process.exit(1));
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
          activeAgent = name;
          console.log(`  ${cyan("⏺")} entered ${bold(name)}`);
          await client.sendCommand({ cmd: "enter_agent", agent: name });
        }
        continue;
      }

      if (cmd === "/exit") {
        if (!activeAgent) {
          console.log(dim("  Not in an agent session"));
        } else {
          const exited = activeAgent;
          activeAgent = null;
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

      if (cmd === "/help" || cmd === "/") {
        if (activeAgent) {
          console.log(dim(`  Current agent: `) + cyan(bold(activeAgent)));
        } else {
          console.log(dim("  Current: orchestrator (no active agent)"));
        }
        console.log(dim("  Commands:"));
        console.log(`    ${cyan("/enter <agent>")}  ${dim("switch to agent session")}`);
        console.log(`    ${cyan("/exit")}           ${dim("return to orchestrator")}`);
        console.log(`    ${cyan("/agents")}         ${dim("list available agents")}`);
        console.log(`    ${cyan("/status")}         ${dim("check sandbox status")}`);
        console.log(`    ${cyan("/ls [path]")}      ${dim("list sandbox files")}`);
        console.log(`    ${cyan("/cat <path>")}     ${dim("read sandbox file")}`);
        console.log(`    ${cyan("/download <r> [l]")} ${dim("download sandbox file to local")}`);
        console.log(`    ${cyan("/help")}           ${dim("show this help")}`);
        continue;
      }
    }

    // Natural language agent entry (e.g. "进入screenwriter", "switch to editor")
    const nlAgent = matchEnterAgent(input, agentNames);
    if (nlAgent) {
      activeAgent = nlAgent;
      console.log(`  ${cyan("⏺")} entered ${bold(nlAgent)}`);
      await client.sendCommand({ cmd: "enter_agent", agent: nlAgent });
      continue;
    }

    // Natural language exit (e.g. "退出", "返回", "exit", "back")
    if (activeAgent && EXIT_RE.test(input)) {
      const exited = activeAgent;
      activeAgent = null;
      console.log(`  ${dim("⏺")} exited ${exited}`);
      await client.sendCommand({ cmd: "exit_agent" });
      continue;
    }

    // Chat
    busy = true;
    await client.chat(input);

    // Wait for result before showing next prompt
    while (busy) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log(dim("\n  Destroying sandbox..."));
  await client.destroy();
  console.log(dim("  Goodbye."));
  rl.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
