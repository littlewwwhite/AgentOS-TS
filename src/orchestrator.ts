// input: Project path, skills dir, CLI flags
// output: Configured SDK session, interactive REPL loop
// pos: Infrastructure layer — provides tools, agents, hooks; LLM drives conversation

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildAgents, filePolicy } from "./agents.js";
import { buildHooks, setWorkspaceRoot } from "./hooks/index.js";
import { loadSkills } from "./loader.js";
import { createCanUseTool } from "./permissions.js";
import { toolServers } from "./tools/index.js";

const VERSION = "0.1.0";
const WORKSPACE_DIRS = ["draft", "episodes", "assets", "production", "output"];
const SESSION_FILE = ".session";
const AT_FILE_RE = /@(\S+)/g;

// ---------- Small utilities ----------

async function readText(filePath: string): Promise<string | null> {
  try {
    return (await fs.readFile(filePath, "utf-8")).trim() || null;
  } catch {
    return null;
  }
}

async function describeWorkspace(projectPath: string): Promise<string> {
  const lines = ["## Workspace"];
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const rootFiles = entries.filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name).sort();
    if (rootFiles.length > 0) lines.push(`  ${rootFiles.join(", ")}`);
    for (const dir of WORKSPACE_DIRS) {
      try {
        const children = (await fs.readdir(path.join(projectPath, dir))).filter((f) => !f.startsWith(".")).sort();
        lines.push(children.length > 0 ? `  ${dir}/: ${children.join(", ")}` : `  ${dir}/: (empty)`);
      } catch { /* skip missing dirs */ }
    }
  } catch {
    lines.push("  (empty)");
  }
  return lines.join("\n");
}

async function expandAtMentions(text: string, projectPath: string): Promise<string> {
  const root = path.resolve(projectPath);
  const matches = [...text.matchAll(AT_FILE_RE)];
  if (matches.length === 0) return text;

  let result = text;
  for (const match of matches.reverse()) {
    const rel = match[1];
    const full = path.resolve(projectPath, rel);
    if (!full.startsWith(root)) continue;
    try {
      let content = await fs.readFile(full, "utf-8");
      if (content.length > 50_000) content = content.slice(0, 50_000) + "\n... (truncated)";
      result = result.slice(0, match.index!) + `\n<file path="${rel}">\n${content}\n</file>\n` + result.slice(match.index! + match[0].length);
      console.log(`  + ${rel}`);
    } catch { /* file not found */ }
  }
  return result;
}

// ---------- Streaming ----------

async function sendAndStream(
  prompt: string,
  options: Record<string, unknown>,
  projectPath: string,
): Promise<void> {
  const t0 = Date.now();
  for await (const msg of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
    if (msg.type === "assistant") {
      for (const b of msg.message.content) {
        if (b.type === "text" && b.text) process.stdout.write(b.text);
      }
    } else if (msg.type === "stream_event") {
      const ev = msg.event as { type?: string; delta?: { type?: string; text?: string } };
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        process.stdout.write(ev.delta.text ?? "");
      }
    } else if (msg.type === "result") {
      const r = msg as unknown as { total_cost_usd?: number; is_error?: boolean; result?: string; session_id?: string };
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log();
      console.log(`  ${r.total_cost_usd ? `$${r.total_cost_usd.toFixed(4)} · ` : ""}${elapsed}s`);
      if (r.is_error) console.error(`  Error: ${r.result}`);
      if (r.session_id) await fs.writeFile(path.join(projectPath, SESSION_FILE), r.session_id, "utf-8");
    }
  }
}

// ---------- Build SDK options ----------

async function buildOptions(projectPath: string, skillsDir: string, model?: string, resume?: string, continueConversation = false) {
  setWorkspaceRoot(projectPath);
  const skills = await loadSkills(skillsDir);
  const agents = buildAgents(skills, toolServers);

  return {
    agents,
    mcpServers: toolServers,
    allowedTools: [
      "Task", "TodoWrite", "TaskCreate", "TaskGet", "TaskUpdate", "TaskList",
      "Read", "Write", "Bash", "Glob", "Grep",
      "mcp__storage__write_json", "mcp__storage__read_json", "mcp__storage__save_asset", "mcp__storage__list_assets",
      "mcp__image__generate_image", "mcp__image__upscale_image",
      "mcp__video__generate_video", "mcp__video__check_video_status",
      "mcp__audio__generate_tts", "mcp__audio__generate_sfx", "mcp__audio__generate_music",
      "mcp__script__parse_script",
    ],
    hooks: buildHooks(),
    canUseTool: createCanUseTool(projectPath, filePolicy),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        "You are a video production workspace assistant.\n" +
        `Project workspace: ${projectPath}/\n` +
        `${await describeWorkspace(projectPath)}\n\n` +
        `${describeSkillList(agents)}\n\n` +
        "## Rules\n" +
        "- Route user intent to the right skill; do not do their work yourself\n" +
        "- All content in Chinese (简体中文), structural keys in English\n" +
        "- Use TodoWrite to show progress on multi-step tasks\n\n" +
        "## Planning Requirement (CRITICAL)\n" +
        "Before executing ANY multi-step task or expensive operations:\n" +
        "1. Use TodoWrite to create a plan showing all steps\n" +
        "2. Mark the first step as 'in_progress' and proceed\n" +
        "3. Update TodoWrite as you complete each step",
    },
    settingSources: ["project"],
    cwd: projectPath,
    permissionMode: "acceptEdits",
    includePartialMessages: true,
    maxBudgetUsd: 10.0,
    model,
    resume,
    continueConversation,
  };
}

function describeSkillList(agents: Record<string, { description: string }>): string {
  const entries = Object.entries(agents);
  if (entries.length === 0) return "";
  return "## Skills (dispatch via Task tool)\n" + entries.map(([n, d]) => `- ${n}: ${d.description}`).join("\n");
}

// ---------- Slash commands ----------

type SlashHandler = (args: {
  agents: Record<string, { description: string }>;
  options: Record<string, unknown>;
  projectPath: string;
}) => Promise<boolean>; // true = handled

const SLASH_COMMANDS: Record<string, SlashHandler> = {
  "/help": async () => {
    console.log("  /skills   — list available workflows and skills");
    console.log("  /tasks    — ask agent to show task board");
    console.log("  /plan     — ask agent to show current todo list");
    console.log("  /session  — show current session ID");
    console.log("  /help     — this message");
    return true;
  },
  "/skills": async ({ agents }) => {
    const entries = Object.entries(agents);
    if (entries.length === 0) {
      console.log("  no skills loaded");
      return true;
    }
    const maxLen = Math.max(...entries.map(([n]) => n.length));
    console.log();
    for (const [name, defn] of entries) {
      console.log(`  ${name.padEnd(maxLen)}  ${defn.description}`);
    }
    return true;
  },
  "/session": async ({ projectPath }) => {
    const sid = await readText(path.join(projectPath, SESSION_FILE));
    console.log(sid ? `  session: ${sid}` : "  no saved session");
    return true;
  },
  "/tasks": async ({ options, projectPath }) => {
    await sendAndStream("Show the current task board using TaskList. Display all tasks with their status.", options, projectPath);
    return true;
  },
  "/plan": async ({ options, projectPath }) => {
    await sendAndStream("Show your current TodoWrite checklist. If you don't have one, say so.", options, projectPath);
    return true;
  },
};

// ---------- REPL ----------

export async function repl(config: {
  projectName?: string;
  inspiration?: string;
  skillsDir?: string;
  model?: string;
  resume?: string;
  continueConversation?: boolean;
}): Promise<void> {
  const { projectName, inspiration, skillsDir = "skills", model } = config;
  let { resume, continueConversation = false } = config;

  const projectPath = path.resolve("workspace", projectName ?? "");
  await fs.mkdir(projectPath, { recursive: true });

  if (inspiration && projectName) {
    await fs.writeFile(path.join(projectPath, "source.txt"), inspiration, "utf-8");
  }

  // Session resolution: --resume > --continue > saved .session
  let isResuming = !!resume;
  if (!resume && continueConversation) {
    resume = (await readText(path.join(projectPath, SESSION_FILE))) ?? undefined;
    if (resume) { isResuming = true; continueConversation = false; }
  }

  const options = await buildOptions(projectPath, skillsDir, model, resume, !resume && continueConversation);
  const agents = (options.agents ?? {}) as Record<string, { description: string }>;
  const agentNames = Object.keys(agents);

  // Header
  console.log(`\n  AgentOS v${VERSION}`);
  const label = projectName ?? "general session";
  console.log(isResuming
    ? `  ${projectPath}  ·  ${label}  ·  resuming ${resume?.slice(0, 12) ?? "last"}…`
    : `  ${projectPath}  ·  ${label}`);
  if (agentNames.length > 0) console.log(`  Skills: ${agentNames.join(" · ")}`);
  console.log("  Ctrl+C · interrupt    Ctrl+C x 2 · exit    /skills · list\n");

  // Initial prompt for new sessions with source material
  if (!isResuming && inspiration && projectName) {
    const preview = inspiration.slice(0, 300).replace(/\n/g, " ");
    await sendAndStream(`Source material ready at ${projectPath}/source.txt\nPreview: ${preview}...\n\nWhat would you like to do?`, options, projectPath);
  }

  // REPL loop
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (): Promise<string> => new Promise((resolve, reject) => {
    rl.question("\n> ", (a) => a === undefined ? reject(new Error("EOF")) : resolve(a));
  });

  let ctrlC = 0;
  process.on("SIGINT", () => {
    if (++ctrlC >= 2) { console.log("\n  Goodbye."); process.exit(0); }
    console.log("\n  Press Ctrl+C again to exit, or keep typing.");
  });

  while (true) {
    let input: string;
    try { input = (await ask()).trim(); ctrlC = 0; }
    catch { console.log("\n  Goodbye."); break; }
    if (!input) continue;

    // Slash commands
    if (input.startsWith("/")) {
      const cmd = input.toLowerCase().split(/\s/)[0];
      const handler = SLASH_COMMANDS[cmd];
      if (handler && await handler({ agents, options, projectPath })) continue;
    }

    // @ file expansion
    if (input.includes("@")) input = await expandAtMentions(input, projectPath);

    await sendAndStream(input, options, projectPath);
  }

  rl.close();
}
