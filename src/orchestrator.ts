// input: Project path, agents dir, skills dir, CLI flags
// output: Configured SDK session, interactive REPL loop
// pos: Infrastructure layer — provides tools, agents, hooks; LLM drives conversation

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import chalk from "chalk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildAgents } from "./agents.js";
import { buildHooks } from "./hooks/index.js";
import { loadAgentConfigs, loadSkillContents } from "./loader.js";
import { createCanUseTool } from "./permissions.js";
import type { AgentFilePolicy } from "./permissions.js";
import { toolServers } from "./tools/index.js";

const VERSION = "0.1.0";
const WORKSPACE_DIRS = ["draft", "draft/episodes", "assets", "production", "output"];
const SESSION_FILE = ".session";
const AT_FILE_RE = /@(\S+)/g;

function sessionFilePath(projectPath: string, agentName?: string | null): string {
  return path.join(projectPath, agentName ? `.session-${agentName}` : SESSION_FILE);
}

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
  // List shared source materials
  try {
    const dataDir = path.resolve(projectPath, "../data");
    const sources = (await fs.readdir(dataDir)).filter((f) => !f.startsWith(".")).sort();
    if (sources.length > 0) lines.push(`  ../data/: ${sources.join(", ")}`);
  } catch { /* no data dir */ }
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
      console.log(chalk.dim(`  + ${rel}`));
    } catch { /* file not found */ }
  }
  return result;
}

// ---------- Streaming ----------

const TODO_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
};

const SIMPLE_TOOLS = new Set(["Read", "Write", "Glob", "Grep", "Edit"]);

function renderTodoList(inputJson: string, indent: string): void {
  try {
    const input = JSON.parse(inputJson) as {
      todos?: { content: string; status: string }[];
    };
    if (!input.todos?.length) return;
    console.log(`${indent}${chalk.dim("Plan:")}`);
    for (const todo of input.todos) {
      const icon = TODO_ICONS[todo.status] ?? "○";
      const color = todo.status === "completed" ? chalk.green.strikethrough
        : todo.status === "in_progress" ? chalk.yellow
        : chalk.dim;
      console.log(`${indent}  ${color(`${icon} ${todo.content}`)}`);
    }
  } catch { /* incomplete JSON */ }
}

function formatToolLabel(name: string, inputJson: string, rootPath?: string): string {
  try {
    const input = JSON.parse(inputJson);
    // Bash: prefer description field, fallback to truncated command
    if (name === "Bash") {
      if (typeof input.description === "string" && input.description.length > 0) {
        return `Bash(${input.description})`;
      }
      if (typeof input.command === "string") {
        const cmd = input.command.trim();
        const short = cmd.length > 60 ? cmd.slice(0, 57) + "…" : cmd;
        return `Bash(${short})`;
      }
      return "Bash";
    }
    // Agent/Task tool: show sub-agent name + short description
    if (name === "Agent" || name === "Task") {
      const agentName = input.subagent_type ?? input.name ?? input.agent ?? null;
      const desc = typeof input.description === "string" ? input.description.slice(0, 50) : "";
      if (agentName) return `${agentName}${desc ? ` — ${desc}` : ""}`;
      if (desc) return `Agent(${desc})`;
      return "Agent";
    }
    // MCP tools: mcp__server__tool → server:tool(key: "value", ...)
    const mcpMatch = name.match(/^mcp__(\w+)__(.+)$/);
    if (mcpMatch) {
      const [, server, tool] = mcpMatch;
      const params = Object.entries(input)
        .filter(([, v]) => v !== undefined && v !== null)
        .slice(0, 3)
        .map(([k, v]) => {
          const sv = typeof v === "string"
            ? (v.length > 30 ? `"${v.slice(0, 30)}…"` : `"${v}"`)
            : JSON.stringify(v);
          return `${k}: ${sv}`;
        })
        .join(", ");
      return `${server}:${tool}${params ? `(${params})` : ""}`;
    }
    // Built-in tools: show primary argument
    const arg =
      input.file_path ?? input.command ?? input.pattern ??
      input.project_path ?? input.url ??
      (typeof input.prompt === "string" ? input.prompt.slice(0, 60) : null) ?? "";
    if (arg) {
      // Skill file: show as "Read skill: skill-name/relative-path"
      if (name === "Read" && typeof arg === "string") {
        const skillMatch = arg.match(/skills\/([^/]+)\/(.+)/);
        if (skillMatch) return `Read skill: ${skillMatch[1]}/${skillMatch[2]}`;
      }
      // Relativize absolute paths against rootPath
      if (typeof arg === "string" && rootPath && arg.startsWith(rootPath)) {
        const rel = arg.slice(rootPath.length).replace(/^\//, "");
        return `${name}(${rel})`;
      }
      const short = typeof arg === "string" && arg.length > 60 ? arg.slice(0, 57) + "…" : arg;
      return `${name}(${short})`;
    }
  } catch { /* incomplete JSON */ }
  return name;
}

function commonDir(paths: string[]): string {
  if (paths.length === 0) return "";
  const segments = paths[0].split("/");
  let depth = 0;
  outer: for (let i = 0; i < segments.length - 1; i++) {
    for (const p of paths) {
      if (p.split("/")[i] !== segments[i]) break outer;
    }
    depth = i + 1;
  }
  return depth > 0 ? segments.slice(0, depth).join("/") + "/" : "";
}

async function sendAndStream(
  prompt: string,
  options: Record<string, unknown>,
  sessionFile: string,
): Promise<string | undefined> {
  const t0 = Date.now();
  const rootPath = typeof options.cwd === "string" ? options.cwd : undefined;
  let lastWasText = false;
  let lastDisplayedToolName: string | null = null;
  const toolBlocks = new Map<number, { name: string; input: string }>();
  let resultSessionId: string | undefined;
  let pendingGroup: { name: string; paths: string[]; indent: string } | null = null;

  function ensureNewline(): void {
    if (lastWasText) { process.stdout.write("\n"); lastWasText = false; }
  }

  function flushGroup(): void {
    if (!pendingGroup) return;
    const { name, paths, indent } = pendingGroup;
    if (paths.length === 1) {
      const rel = rootPath && paths[0].startsWith(rootPath)
        ? paths[0].slice(rootPath.length).replace(/^\//, "") : paths[0];
      console.log(`${indent}${chalk.cyan("⏺")} ${chalk.white(`${name}(${rel})`)}`);
    } else {
      const parts = paths.map(p => rootPath && p.startsWith(rootPath)
        ? p.slice(rootPath.length).replace(/^\//, "") : p);
      const dir = commonDir(parts);
      console.log(`${indent}${chalk.cyan("⏺")} ${chalk.white(`${name} ${paths.length} files`)} ${chalk.dim(`(${dir})`)}`);
    }
    pendingGroup = null;
  }

  for await (const msg of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
    switch (msg.type) {
      case "stream_event": {
        const ev = msg.event as Record<string, unknown>;
        const isNested = !!(msg as { parent_tool_use_id?: string | null }).parent_tool_use_id;
        const indent = isNested ? "    " : "  ";

        if (ev.type === "content_block_start") {
          const block = ev.content_block as { type?: string; name?: string; id?: string };
          if (block?.type === "tool_use" && block.name) {
            const idx = ev.index as number;
            toolBlocks.set(idx, { name: block.name, input: "" });
          }
        } else if (ev.type === "content_block_delta") {
          const delta = ev.delta as { type?: string; text?: string; partial_json?: string };
          if (delta?.type === "text_delta" && delta.text) {
            flushGroup();
            process.stdout.write(delta.text);
            lastWasText = true;
          } else if (delta?.type === "input_json_delta" && delta.partial_json) {
            const idx = ev.index as number;
            const tool = toolBlocks.get(idx);
            if (tool) tool.input += delta.partial_json;
          }
        } else if (ev.type === "content_block_stop") {
          const idx = ev.index as number;
          const tool = toolBlocks.get(idx);
          if (tool) {
            ensureNewline();
            if (tool.name === "TodoWrite") {
              flushGroup();
              renderTodoList(tool.input, indent);
            } else {
              const GROUPABLE = new Set(["Read", "Write", "Edit"]);
              let filePath: string | null = null;
              try { filePath = JSON.parse(tool.input).file_path ?? null; } catch {}

              if (GROUPABLE.has(tool.name) && filePath) {
                if (pendingGroup && pendingGroup.name === tool.name) {
                  pendingGroup.paths.push(filePath);
                } else {
                  flushGroup();
                  pendingGroup = { name: tool.name, paths: [filePath], indent };
                }
              } else {
                flushGroup();
                const label = formatToolLabel(tool.name, tool.input, rootPath);
                console.log(`${indent}${chalk.cyan("⏺")} ${chalk.white(label)}`);
              }
            }
            lastDisplayedToolName = tool.name;
            toolBlocks.delete(idx);
          }
        }
        break;
      }

      case "assistant": {
        // Text already streamed via stream_event; only surface errors
        const m = msg as unknown as { error?: { message?: string } };
        if (m.error?.message) {
          ensureNewline();
          console.error(chalk.red(`  ✗ ${m.error.message}`));
        }
        break;
      }

      case "tool_use_summary": {
        const s = msg as unknown as { summary?: string; tool_summary?: string };
        const text = s.summary ?? s.tool_summary;
        if (text && !SIMPLE_TOOLS.has(lastDisplayedToolName ?? "")) {
          ensureNewline();
          console.log(`  ${chalk.dim("⎿")}  ${text}`);
        }
        lastDisplayedToolName = null;
        break;
      }

      case "result": {
        const r = msg as unknown as {
          total_cost_usd?: number; is_error?: boolean; result?: string;
          session_id?: string; num_turns?: number;
        };
        flushGroup();
        ensureNewline();
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const parts: string[] = [];
        if (r.total_cost_usd) parts.push(`$${r.total_cost_usd.toFixed(4)}`);
        parts.push(`${elapsed}s`);
        if (r.num_turns) parts.push(`${r.num_turns} turns`);
        console.log(chalk.dim(`  ⎿  ${parts.join(" · ")}`));
        if (r.is_error) console.error(chalk.red(`  ✗ ${r.result}`));
        if (r.session_id) {
          resultSessionId = r.session_id;
          await fs.writeFile(sessionFile, r.session_id, "utf-8");
        }
        break;
      }

      case "system": {
        const sys = msg as unknown as {
          subtype?: string;
          status?: string | null;
          compact_metadata?: { trigger: string; pre_tokens: number };
        };
        if (sys.subtype === "status" && sys.status === "compacting") {
          ensureNewline();
          console.log(`  ${chalk.cyan("⏺")} ${chalk.yellow("compacting context…")}`);
        } else if (sys.subtype === "compact_boundary" && sys.compact_metadata) {
          const tokens = sys.compact_metadata.pre_tokens;
          const trigger = sys.compact_metadata.trigger;
          console.log(`    ${chalk.dim("⎿")}  ${chalk.dim(`compacted (${trigger}, ${tokens} tokens before)`)}`);
        }
        break;
      }

      default: {
        // Handle SDK message types not yet in the type union
        const t = (msg as Record<string, unknown>).type;
        if (t === "streamlined_tool_use_summary") {
          const s = msg as unknown as { summary?: string; tool_summary?: string };
          const text = s.summary ?? s.tool_summary;
          if (text && !SIMPLE_TOOLS.has(lastDisplayedToolName ?? "")) {
            ensureNewline();
            console.log(`  ${chalk.dim("⎿")}  ${text}`);
          }
          lastDisplayedToolName = null;
        } else if (t && t !== "user" && t !== "keep_alive") {
          console.log(chalk.dim(`  [debug] unhandled msg.type: ${t}`));
        }
        break;
      }
    }
  }
  return resultSessionId;
}

// ---------- Build SDK options ----------

export async function buildOptions(
  projectPath: string,
  agentsDir: string,
  skillsDir: string,
  model?: string,
  resume?: string,
  continueConversation = false,
) {
  const agentConfigs = await loadAgentConfigs(agentsDir);
  const skillContents = await loadSkillContents(skillsDir);
  const agents = buildAgents(agentConfigs, skillContents, toolServers, projectPath);

  // Extract file policies from agent configs
  const policies: Record<string, AgentFilePolicy> = {};
  for (const [name, config] of Object.entries(agentConfigs)) {
    if (config.filePolicy) policies[name] = config.filePolicy;
  }

  return {
    agents,
    mcpServers: toolServers,
    allowedTools: [
      "Agent", "TodoWrite",
      "Read", "Write", "Bash", "Glob", "Grep",
    ],
    hooks: buildHooks(projectPath),
    canUseTool: createCanUseTool(projectPath, policies),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        "You are a video production orchestrator.\n" +
        "Your ONLY job is to understand user intent and dispatch to the right sub-agent.\n" +
        "Do NOT perform domain work (writing scripts, generating images, etc.) yourself.\n\n" +
        `Project workspace: ${projectPath}/\n` +
        `Source materials: ${path.resolve(projectPath, "../data")}/\n` +
        `${await describeWorkspace(projectPath)}\n\n` +
        `${describeAgentList(agents)}\n\n` +
        "## Rules\n" +
        "- Dispatch domain tasks to the appropriate sub-agent via the Agent tool\n" +
        "- All content in Chinese (简体中文), structural keys in English\n" +
        "- Use TodoWrite to show progress on multi-step tasks\n" +
        "- When user references a source file (e.g. '测0.txt'), copy it from source materials to workspace as source.txt, then dispatch\n\n" +
        "## Planning Requirement\n" +
        "Before dispatching any multi-step task:\n" +
        "1. Use TodoWrite to outline the plan\n" +
        "2. Dispatch to the sub-agent\n" +
        "3. Update TodoWrite as steps complete",
    },
    betas: ["context-1m-2025-08-07"],
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

function describeAgentList(agents: Record<string, { description: string }>): string {
  const entries = Object.entries(agents);
  if (entries.length === 0) return "";
  return "## Sub-Agents (dispatch via Agent tool, subagent_type = name)\n" +
    entries.map(([n, d]) => `- **${n}**: ${d.description}`).join("\n");
}

// ---------- Slash commands ----------

type SlashHandler = (args: {
  agents: Record<string, { description: string }>;
  options: Record<string, unknown>;
  projectPath: string;
  activeAgent: string | null;
}) => Promise<boolean>; // true = handled

const SLASH_COMMANDS: Record<string, SlashHandler> = {
  "/help": async ({ activeAgent }) => {
    console.log(`  ${chalk.cyan("/agents")}   — list available sub-agents`);
    console.log(`  ${chalk.cyan("/enter")}    — enter a sub-agent for direct conversation`);
    if (activeAgent) {
      console.log(`  ${chalk.cyan("/exit")}     — return to orchestrator`);
    }
    console.log(`  ${chalk.cyan("/plan")}     — show current todo list`);
    console.log(`  ${chalk.cyan("/session")}  — show current session ID`);
    console.log(`  ${chalk.cyan("/help")}     — this message`);
    return true;
  },
  "/agents": async ({ agents }) => {
    const entries = Object.entries(agents);
    if (entries.length === 0) {
      console.log(chalk.dim("  no agents loaded"));
      return true;
    }
    const maxLen = Math.max(...entries.map(([n]) => n.length));
    console.log();
    for (const [name, defn] of entries) {
      console.log(`  ${chalk.cyan(name.padEnd(maxLen))}  ${chalk.dim(defn.description)}`);
    }
    return true;
  },
  "/session": async ({ projectPath, activeAgent }) => {
    const sf = sessionFilePath(projectPath, activeAgent);
    const sid = await readText(sf);
    const label = activeAgent ? `session (${activeAgent})` : "session";
    console.log(sid ? `  ${label}: ${chalk.dim(sid)}` : chalk.dim(`  no saved ${label}`));
    return true;
  },
  "/plan": async ({ options, projectPath, activeAgent }) => {
    const sf = sessionFilePath(projectPath, activeAgent);
    await sendAndStream("Show your current TodoWrite checklist. If you don't have one, say so.", options, sf);
    return true;
  },
};

// ---------- REPL ----------

export async function repl(config: {
  projectName?: string;
  inspiration?: string;
  agentsDir?: string;
  skillsDir?: string;
  model?: string;
  resume?: string;
  continueConversation?: boolean;
}): Promise<void> {
  const { projectName, inspiration, agentsDir = "agents", skillsDir = "skills", model } = config;
  let { resume, continueConversation = false } = config;

  const projectPath = path.resolve("workspace", projectName ?? "");
  await fs.mkdir(projectPath, { recursive: true });

  if (inspiration && projectName) {
    await fs.writeFile(path.join(projectPath, "source.txt"), inspiration, "utf-8");
  }

  // Session resolution: --resume > --continue > saved .session
  let isResuming = !!resume;
  if (!resume && continueConversation) {
    resume = (await readText(sessionFilePath(projectPath))) ?? undefined;
    if (resume) { isResuming = true; continueConversation = false; }
  }

  const options = await buildOptions(projectPath, agentsDir, skillsDir, model, resume, !resume && continueConversation) as Record<string, unknown>;
  const agents = (options.agents ?? {}) as Record<string, { description: string }>;
  const agentNames = Object.keys(agents);

  // Header
  console.log(`\n  ${chalk.bold("AgentOS")} ${chalk.dim(`v${VERSION}`)}`);
  const label = projectName ?? "general session";
  console.log(isResuming
    ? `  ${chalk.dim(projectPath)}  ${chalk.white(label)}  ${chalk.yellow(`resuming ${resume?.slice(0, 12) ?? "last"}…`)}`
    : `  ${chalk.dim(projectPath)}  ${chalk.white(label)}`);
  if (agentNames.length > 0) {
    const maxLen = Math.max(...agentNames.map(n => n.length));
    console.log(`  ${chalk.dim("Agents:")}`);
    for (const name of agentNames) {
      const desc = agents[name].description;
      const short = desc.length > 50 ? desc.slice(0, 50) + "…" : desc;
      console.log(`    ${chalk.cyan(name.padEnd(maxLen))}  ${chalk.dim(short)}`);
    }
  }
  console.log(chalk.dim("  Ctrl+C · interrupt    Ctrl+C x 2 · exit    /enter <agent> · direct mode\n"));

  // Initial prompt for new sessions with source material
  if (!isResuming && inspiration && projectName) {
    const sf = sessionFilePath(projectPath);
    const preview = inspiration.slice(0, 300).replace(/\n/g, " ");
    const sid = await sendAndStream(`Source material ready at ${projectPath}/source.txt\nPreview: ${preview}...\n\nWhat would you like to do?`, options, sf);
    if (sid) (options as Record<string, unknown>).resume = sid;
  }

  // REPL state
  let activeAgent: string | null = null;
  const agentSessions = new Map<string, string>();

  // Slash command completions
  const slashCmds = ["/help", "/agents", "/enter", "/exit", "/plan", "/session"];

  const completer = (line: string): [string[], string] => {
    if (!line.startsWith("/")) return [[], line];

    // "/enter <partial>" → complete agent names
    const enterMatch = line.match(/^\/enter\s+(.*)/);
    if (enterMatch) {
      const partial = enterMatch[1];
      const hits = agentNames.filter(n => n.startsWith(partial));
      return [hits.map(n => `/enter ${n}`), line];
    }

    // Partial slash command → match commands
    const hits = slashCmds.filter(c => c.startsWith(line));
    return [hits, line];
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
  });
  const ask = (): Promise<string> => new Promise((resolve, reject) => {
    const prompt = activeAgent
      ? chalk.cyan(`\n${activeAgent} ❯ `)
      : chalk.cyan("\n❯ ");
    rl.question(prompt, (a) => a === undefined ? reject(new Error("EOF")) : resolve(a));
  });

  let ctrlC = 0;
  process.on("SIGINT", () => {
    if (++ctrlC >= 2) { console.log(chalk.dim("\n  Goodbye.")); process.exit(0); }
    console.log(chalk.dim("\n  Press Ctrl+C again to exit, or keep typing."));
  });

  while (true) {
    let input: string;
    try { input = (await ask()).trim(); ctrlC = 0; }
    catch { console.log(chalk.dim("\n  Goodbye.")); break; }
    if (!input) continue;

    // Slash commands
    if (input.startsWith("/")) {
      // Bare "/" — show all available commands
      if (input === "/") {
        console.log(chalk.dim("  Available commands:"));
        for (const c of slashCmds) console.log(`    ${chalk.cyan(c)}`);
        continue;
      }

      const parts = input.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      // /enter <agent> — switch to direct agent conversation
      if (cmd === "/enter") {
        const name = parts[1];
        if (!name) {
          console.log(chalk.dim("  Usage: /enter <agent-name>"));
        } else if (!agents[name]) {
          console.log(chalk.red(`  Unknown agent: ${name}`));
          console.log(chalk.dim(`  Available: ${agentNames.join(", ")}`));
        } else {
          activeAgent = name;
          // Load saved session for this agent
          if (!agentSessions.has(name)) {
            const saved = await readText(sessionFilePath(projectPath, name));
            if (saved) agentSessions.set(name, saved);
          }
          const desc = agents[name].description;
          const short = desc.length > 60 ? desc.slice(0, 60) + "…" : desc;
          const hasSavedSession = agentSessions.has(name);
          console.log();
          console.log(`  ${chalk.cyan("⏺")} ${chalk.bgCyan.black(` ${name} `)} ${chalk.dim(short)}`);
          if (hasSavedSession) console.log(`    ${chalk.dim("⎿")}  ${chalk.yellow("resuming previous session")}`);
          console.log(`    ${chalk.dim("⎿")}  ${chalk.dim("/exit to return to orchestrator")}`);
        }
        continue;
      }

      // /exit — return to orchestrator
      if (cmd === "/exit") {
        if (!activeAgent) {
          console.log(chalk.dim("  Not in an agent session"));
        } else {
          console.log(`\n  ${chalk.cyan("⏺")} ${chalk.dim(`exited ${activeAgent}`)} ${chalk.yellow("← orchestrator")}`);
          activeAgent = null;
        }
        continue;
      }

      const handler = SLASH_COMMANDS[cmd];
      if (handler && await handler({ agents, options, projectPath, activeAgent })) continue;
    }

    // @ file expansion
    if (input.includes("@")) input = await expandAtMentions(input, projectPath);

    // Build effective options based on active context
    const sf = sessionFilePath(projectPath, activeAgent);
    let effectiveOptions: Record<string, unknown>;
    if (activeAgent) {
      // Strip orchestrator identity; agent uses its own AgentDefinition.prompt
      const { systemPrompt: _orchestratorPrompt, ...agentOptions } = options;
      effectiveOptions = {
        ...agentOptions,
        agent: activeAgent,
        resume: agentSessions.get(activeAgent),
        continueConversation: false,
        settingSources: [], // prevent global CLAUDE.md from overriding agent role
      };
    } else {
      effectiveOptions = options;
    }

    const sid = await sendAndStream(input, effectiveOptions, sf);

    // Update session tracking for subsequent queries
    if (sid) {
      if (activeAgent) {
        agentSessions.set(activeAgent, sid);
      } else {
        (options as Record<string, unknown>).resume = sid;
      }
    }
  }

  rl.close();
}
