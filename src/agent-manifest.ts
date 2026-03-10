import fs from "node:fs/promises";
import path from "node:path";

import { loadAgentConfigs } from "./loader.js";

export interface AgentManifest {
  name: string;
  description: string;
  skills: string[];
  mcpServers: string[];
}

async function listMarkdownSkillNames(skillsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

export async function loadAgentManifests(
  agentsDir: string,
): Promise<Record<string, AgentManifest>> {
  const configs = await loadAgentConfigs(agentsDir);
  const manifests: Record<string, AgentManifest> = {};

  for (const [name, config] of Object.entries(configs)) {
    const skillsDir = path.join(agentsDir, name, ".claude", "skills");
    const diskSkills = await listMarkdownSkillNames(skillsDir);

    manifests[name] = {
      name,
      description: config.description,
      skills: diskSkills,
      mcpServers: [...(config.mcpServers ?? [])],
    };
  }

  return manifests;
}
