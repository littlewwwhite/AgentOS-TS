import fs from "node:fs/promises";
import path from "node:path";

import { loadAgentConfigs } from "./loader.js";
import type { ToolServerName } from "./tools/index.js";

export interface AgentManifest {
  name: string;
  description: string;
  skills: string[];
  mcpServers: ToolServerName[];
}

async function listSkillNames(skillsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      try {
        await fs.access(path.join(skillsDir, entry.name, "SKILL.md"));
        names.push(entry.name);
      } catch {
        // subdirectory without SKILL.md — skip
      }
    }
    return names.sort();
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
    const diskSkills = await listSkillNames(skillsDir);

    manifests[name] = {
      name,
      description: config.description,
      skills: diskSkills,
      mcpServers: [...(config.mcpServers ?? [])],
    };
  }

  return manifests;
}
