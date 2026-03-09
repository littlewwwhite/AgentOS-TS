// input: Project path, agents dir, CLI flags
// output: SDK-compatible options with lightweight agent routing map
// pos: Configuration factory — builds orchestrator options; agent config loaded by SDK from .claude/ dirs

import fs from "node:fs/promises";
import path from "node:path";

import { buildHooks } from "./hooks/index.js";
import { loadAgentConfigs } from "./loader.js";
import { toolServers } from "./tools/index.js";

export const WORKSPACE_DIRS = ["draft", "draft/episodes", "assets", "production", "output"];

export async function describeWorkspace(projectPath: string): Promise<string> {
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

export function describeAgentList(
  agents: Record<string, { description: string; configuredSkills?: string[] }>,
): string {
  const entries = Object.entries(agents);
  if (entries.length === 0) return "";
  return "## Sub-Agents (dispatch via switch_to_agent tool)\n" +
    entries.map(([n, d]) => {
      const skillTag = d.configuredSkills?.length
        ? ` [skills: ${d.configuredSkills.join(", ")}]`
        : "";
      return `- **${n}**: ${d.description}${skillTag}`;
    }).join("\n");
}

const MAX_BUDGET_USD = 10.0;

export async function buildOptions(
  projectPath: string,
  agentsDir: string,
  model?: string,
  resume?: string,
  continueConversation = false,
) {
  const agentConfigs = await loadAgentConfigs(agentsDir);

  // Build lightweight agent definitions for orchestrator routing only.
  // Full agent config (prompt, skills, permissions) lives in agents/<name>/.claude/
  // and is loaded natively by SDK when cwd points to the agent directory.
  const agents: Record<string, { description: string; configuredSkills?: string[] }> = {};
  for (const [name, config] of Object.entries(agentConfigs)) {
    agents[name] = {
      description: config.description,
      configuredSkills: config.skills,
    };
  }

  return {
    agents,
    mcpServers: toolServers,
    allowedTools: [
      "TodoWrite",
      "Read", "Write", "Bash", "Glob", "Grep",
    ],
    hooks: buildHooks(undefined, MAX_BUDGET_USD),
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
        "## Dispatch Rules (STRICT)\n" +
        "- Use the `switch_to_agent` tool to delegate domain tasks to specialized agents\n" +
        "- The agent will work in its own persistent context and return with a summary when done\n" +
        "- You will receive the agent's summary as a message — use it to continue the conversation\n" +
        "- If user mentions a skill name, map it to the owning agent via [skills: ...] tags above\n" +
        "- NEVER read files under skills/ directory or run Python scripts directly\n" +
        "- NEVER perform domain work yourself — always delegate to the owning sub-agent\n" +
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
    maxBudgetUsd: MAX_BUDGET_USD,
    model,
    resume,
    continueConversation,
  };
}
