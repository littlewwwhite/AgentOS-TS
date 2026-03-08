// input: Loaded skill frontmatter + file policy config
// output: AgentDefinition records + per-agent file policies
// pos: Agent factory — maps skill definitions to SDK AgentDefinition with isolation config

import type { AgentFilePolicy } from "./permissions.js";

// Re-export for external consumers
export type { AgentFilePolicy };

// --- File permission matrix ---
// Workspace-relative glob patterns per agent role.
// Agents not listed here have no file-level restrictions.

export const filePolicy: Record<string, AgentFilePolicy> = {
  "script-writer": {
    readable: ["source.txt", "draft/**", "design.json", "catalog.json"],
    writable: ["draft/**", "design.json", "catalog.json"],
  },
  "script-adapt": {
    readable: ["draft/**", "design.json", "catalog.json", "output/script.json"],
    writable: ["draft/**", "output/script.json"],
  },
  "image-create": {
    readable: ["output/script.json", "catalog.json", "assets/**"],
    writable: ["assets/**"],
  },
  "image-edit": {
    readable: ["output/script.json", "catalog.json", "assets/**"],
    writable: ["assets/**"],
  },
  "video-create": {
    readable: ["output/script.json", "assets/**", "storyboard/**", "production/**"],
    writable: ["production/**"],
  },
  "video-review": {
    readable: ["output/script.json", "production/**"],
    writable: ["production/**"],
  },
  "music-finder": {
    readable: ["output/script.json", "editing/**", "audio/**"],
    writable: ["audio/**"],
  },
  "music-matcher": {
    readable: ["output/script.json", "editing/**", "audio/**"],
    writable: ["editing/audio_plan.json", "audio/**"],
  },
};

// --- Skill frontmatter → AgentDefinition builder ---

export interface SkillFrontmatter {
  name: string;
  description: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: string[];
  maxTurns?: number;
  model?: string;
}

export interface AgentDefinitionConfig {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  maxTurns?: number;
  model?: string;
}

export function buildAgents(
  skills: Record<string, SkillFrontmatter & { prompt: string }>,
  toolServerMap: Record<string, unknown>,
): Record<string, AgentDefinitionConfig> {
  const agents: Record<string, AgentDefinitionConfig> = {};

  for (const [name, skill] of Object.entries(skills)) {
    const mcpServers: Record<string, unknown> = {};
    if (skill.mcpServers) {
      for (const serverName of skill.mcpServers) {
        if (serverName in toolServerMap) {
          mcpServers[serverName] = toolServerMap[serverName];
        }
      }
    }

    agents[name] = {
      description: skill.description,
      prompt: skill.prompt,
      tools: skill.allowedTools,
      disallowedTools: skill.disallowedTools ?? [],
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      maxTurns: skill.maxTurns ?? 30,
      model: skill.model,
    };
  }

  return agents;
}
