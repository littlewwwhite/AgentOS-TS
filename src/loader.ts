// input: agents/ directory (YAML routing metadata)
// output: Agent routing configs for orchestrator dispatch
// pos: Bridge — loads agent routing metadata from declarative files

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

// --- Agent config loading (agents/*.yaml) ---

export interface AgentConfig {
  name: string;
  description: string;
  skills?: string[];
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
      skills: (config.skills as string[]) ?? undefined,
    };
  }

  return agents;
}
