// input: SandboxClient, .env, terminal stdin
// output: Interactive REPL session over E2B sandbox
// pos: Developer tool — provides bun-start-like experience with agent running in E2B
//
// Usage: bun scripts/e2b-repl.ts

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { SandboxClient } from "../src/e2b-client.js";
import type { SandboxEvent } from "../src/protocol.js";
import { matchEnterAgent } from "../src/protocol.js";

// ---------- .env ----------

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

// ---------- State ----------

let activeAgent: string | null = null;
let agentNames: string[] = [];
let busy = false;
let textStarted = false; // track whether we've printed the agent label for current turn

// ---------- Event handler ----------

function handleEvent(event: SandboxEvent): void {
  switch (event.type) {
    case "ready":
      agentNames = event.skills ?? [];
      break;

    case "text": {
      if (!textStarted && event.agent) {
        process.stdout.write(dim(`[${event.agent}] `));
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

    case "agent_entered":
      activeAgent = event.agent;
      console.log(`  ${cyan("⏺")} entered ${bold(event.agent)}`);
      break;

    case "agent_exited":
      console.log(`  ${dim("⏺")} exited ${event.agent}`);
      activeAgent = null;
      break;
  }
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
  });

  const ask = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const prompt = activeAgent
        ? cyan(`\n${activeAgent} ❯ `)
        : cyan("\n❯ ");
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
          await client.sendCommand({ cmd: "enter_agent", agent: name });
        }
        continue;
      }

      if (cmd === "/exit") {
        if (!activeAgent) {
          console.log(dim("  Not in an agent session"));
        } else {
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

      if (cmd === "/help" || cmd === "/") {
        console.log(dim("  Commands:"));
        console.log(`    ${cyan("/enter <agent>")}  ${dim("switch to agent session")}`);
        console.log(`    ${cyan("/exit")}           ${dim("return to orchestrator")}`);
        console.log(`    ${cyan("/agents")}         ${dim("list available agents")}`);
        console.log(`    ${cyan("/status")}         ${dim("check sandbox status")}`);
        console.log(`    ${cyan("/help")}           ${dim("show this help")}`);
        continue;
      }
    }

    // Natural language agent entry (e.g. "进入screenwriter", "switch to editor")
    const nlAgent = matchEnterAgent(input, agentNames);
    if (nlAgent) {
      await client.sendCommand({ cmd: "enter_agent", agent: nlAgent });
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
