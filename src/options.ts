// input: Project path, agents dir, CLI flags
// output: SDK-compatible options with lightweight agent routing map
// pos: Configuration factory — builds orchestrator options; agent config loaded by SDK from .claude/ dirs

import fs from "node:fs/promises";
import path from "node:path";

import { loadAgentManifests } from "./agent-manifest.js";
import { buildHooks } from "./hooks/index.js";
import { buildMainSessionSpec } from "./session-specs.js";
import { createToolServers } from "./tools/index.js";

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

export { describeAgentList } from "./session-specs.js";

const MAX_BUDGET_USD = 10.0;

export async function buildOptions(
  projectPath: string,
  agentsDir: string,
  model?: string,
  resume?: string,
  shouldContinue = false,
) {
  const manifests = await loadAgentManifests(agentsDir);
  const workspaceDescription = await describeWorkspace(projectPath);

  // Internal orchestrator routing map — NOT consumed by the SDK.
  // SDK's AgentDefinition requires `prompt` and is used for its built-in Agent tool,
  // which we don't enable (not in allowedTools). We use our own switch_to_agent MCP
  // tool instead. sandbox-orchestrator.ts reads this from the returned options to
  // enumerate agent names and descriptions.
  // Full agent config (prompt, skills, permissions) lives in agents/<name>/.claude/
  // and is loaded natively by SDK when cwd points to the agent directory.
  const agents: Record<string, {
    description: string;
    configuredSkills?: string[];
    mcpServers?: string[];
  }> = {};
  for (const [name, manifest] of Object.entries(manifests)) {
    agents[name] = {
      description: manifest.description,
      configuredSkills: manifest.skills,
      mcpServers: manifest.mcpServers,
    };
  }

  const spec = await buildMainSessionSpec({
    projectPath,
    agents,
    workspaceDescription,
  });

  return {
    agents,
    mcpServers: createToolServers([]),
    allowedTools: spec.allowedTools,
    disallowedTools: spec.disallowedTools,
    hooks: buildHooks(),
    systemPrompt: spec.systemPrompt,
    // SDK SdkBeta type still defines this as the only valid beta (enables 1M context
    // window for Sonnet 4/4.5). Not yet graduated to stable as of SDK 0.x.
    betas: ["context-1m-2025-08-07"],
    settingSources: spec.settingSources,
    cwd: spec.cwd,
    permissionMode: spec.permissionMode,
    includePartialMessages: true,
    maxBudgetUsd: MAX_BUDGET_USD,
    model,
    resume,
    continue: shouldContinue,
  };
}
