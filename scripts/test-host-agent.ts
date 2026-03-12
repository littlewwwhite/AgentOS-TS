#!/usr/bin/env bun
// Minimal test: verify Claude Agent SDK loads agent config on host side

import path from "node:path";

// SDK refuses to run inside another Claude Code session — clear the guard
delete process.env.CLAUDECODE;
// Also clear proxy URL that points to host Claude Code's local proxy
if (process.env.ANTHROPIC_BASE_URL?.match(/^https?:\/\/(127\.0\.0\.1|localhost)/)) {
  delete process.env.ANTHROPIC_BASE_URL;
}

import { query } from "@anthropic-ai/claude-agent-sdk";

const ROOT = path.resolve(import.meta.dir, "..");
const AGENTS_DIR = path.join(ROOT, "agents");
const PROJECT_PATH = path.join(ROOT, "workspace", "__test__");

await Bun.write(path.join(PROJECT_PATH, ".keep"), "");

const agentName = "art-director";
const agentCwd = path.resolve(AGENTS_DIR, agentName);

console.log(`Agent CWD: ${agentCwd}`);
console.log(`Skills: ${(await Array.fromAsync(new Bun.Glob("*/SKILL.md").scan({ cwd: path.join(agentCwd, ".claude", "skills") }))).join(", ")}\n`);

try {
  const q = query({
    prompt: "Use the Skill tool to list what skills are available to you. If you cannot list skills, just say what tools you see.",
    options: {
      cwd: agentCwd,
      settingSources: ["project"],
      permissionMode: "bypassPermissions",
      model: process.env.AGENTOS_MODEL || "claude-sonnet-4-6",
      maxTurns: 3,
      systemPrompt: "List all skills available to you. Use Chinese.",
      stderr: (data: string) => {
        process.stderr.write(`[sdk-stderr] ${data}\n`);
      },
    },
  });

  for await (const event of q) {
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block.type === "text") console.log(`[response] ${block.text}`);
      }
    } else if (event.type === "error") {
      console.error(`[event-error] ${JSON.stringify(event)}`);
    } else {
      // Log event type for debugging
      console.log(`[event] ${event.type}`);
    }
  }
  console.log("\n✓ Success");
} catch (err) {
  console.error(`\n✗ Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
} finally {
  await Bun.spawn(["rm", "-rf", PROJECT_PATH]).exited;
}
