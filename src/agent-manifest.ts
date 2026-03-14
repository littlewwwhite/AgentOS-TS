// input: agents/ directory, skill YAML frontmatter
// output: Agent manifests with skills + auto-derived mcpServers
// pos: Bridge — merges YAML config, disk skill discovery, and skill-declared MCP dependencies

import fs from "node:fs/promises";
import path from "node:path";

import { loadAgentConfigs } from "./loader.js";
import { isToolServerName, type ToolServerName } from "./tools/index.js";

export interface AgentManifest {
  name: string;
  description: string;
  skills: string[];
  mcpServers: ToolServerName[];
}

// ---------------------------------------------------------------------------
// Skill discovery
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SKILL.md frontmatter → MCP server names
// ---------------------------------------------------------------------------

/**
 * Extract MCP server names from a SKILL.md's `allowed-tools` frontmatter.
 * Parses `mcp__<server>__<tool>` patterns to derive the set of required servers.
 */
async function extractMcpServersFromSkill(
  skillMdPath: string,
): Promise<ToolServerName[]> {
  let content: string;
  try {
    content = await fs.readFile(skillMdPath, "utf-8");
  } catch {
    return [];
  }

  // Quick YAML frontmatter extraction (between --- delimiters)
  if (!content.startsWith("---")) return [];
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return [];
  const frontmatter = content.substring(3, endIdx);

  // Extract allowed-tools entries — handles both list and inline array formats
  const servers = new Set<ToolServerName>();

  // Match lines like: "  - mcp__awb__awb_get_auth" or inline ["mcp__awb__*", ...]
  for (const match of frontmatter.matchAll(/mcp__([^_\s"'\],]+)__/g)) {
    const serverName = match[1]!;
    if (isToolServerName(serverName)) {
      servers.add(serverName);
    }
  }

  return [...servers];
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

export async function loadAgentManifests(
  agentsDir: string,
): Promise<Record<string, AgentManifest>> {
  const configs = await loadAgentConfigs(agentsDir);
  const manifests: Record<string, AgentManifest> = {};

  for (const [name, config] of Object.entries(configs)) {
    const skillsDir = path.join(agentsDir, name, ".claude", "skills");
    const diskSkills = await listSkillNames(skillsDir);

    // Collect MCP servers: YAML explicit + skill-derived (auto)
    const serverSet = new Set<ToolServerName>(
      (config.mcpServers ?? []).filter(isToolServerName),
    );

    // Scan each skill's SKILL.md for mcp__<server>__* tool references
    for (const skill of diskSkills) {
      const skillMdPath = path.join(skillsDir, skill, "SKILL.md");
      const derived = await extractMcpServersFromSkill(skillMdPath);
      for (const s of derived) serverSet.add(s);
    }

    manifests[name] = {
      name,
      description: config.description,
      skills: diskSkills,
      mcpServers: [...serverSet],
    };
  }

  return manifests;
}
