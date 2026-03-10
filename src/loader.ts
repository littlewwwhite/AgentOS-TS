// input: agents/ directory (YAML routing metadata)
// output: Agent routing configs for orchestrator dispatch
// pos: Bridge — loads agent routing metadata from declarative files

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

import { isToolServerName, type ToolServerName } from "./tools/index.js";

// --- Agent config loading (agents/*.yaml) ---

export interface AgentConfig {
  name: string;
  description: string;
  mcpServers?: ToolServerName[];
}

function parseToolServerNames(value: unknown): ToolServerName[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.filter(
    (entry): entry is ToolServerName => typeof entry === "string" && isToolServerName(entry),
  );
}

export async function loadAgentConfigs(agentsDir: string): Promise<Record<string, AgentConfig>> {
  const agents: Record<string, AgentConfig> = {};

  try {
    await fs.access(agentsDir);
  } catch {
    return agents;
  }

  const entries = await fs.readdir(agentsDir);
  const yamlFiles = entries.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();

  for (const file of yamlFiles) {
    const text = await fs.readFile(path.join(agentsDir, file), "utf-8");
    const config = yaml.parse(text) as Record<string, unknown>;
    const name = config.name as string | undefined;
    if (!name) continue;

    agents[name] = {
      name,
      description: (config.description as string) ?? "",
      mcpServers: parseToolServerNames(config.mcpServers),
    };
  }

  return agents;
}
