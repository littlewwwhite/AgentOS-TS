// input: agents/ directory (YAML configs) + skills/ directory (pure markdown content)
// output: Agent configs + skill content map, ready for buildAgents()
// pos: Bridge — loads agent definitions and skill content from declarative files

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

// --- Agent config loading (agents/*.yaml) ---

export interface AgentConfig {
  name: string;
  description: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: string[];
  skills?: string[];
  maxTurns?: number;
  model?: string;
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
      allowedTools: (config["allowed-tools"] as string[]) ?? undefined,
      disallowedTools: (config["disallowed-tools"] as string[]) ?? undefined,
      mcpServers: (config["mcp-servers"] as string[]) ?? undefined,
      skills: (config.skills as string[]) ?? undefined,
      maxTurns: (config["max-turns"] as number) ?? undefined,
      model: (config.model as string) ?? undefined,
    };
  }

  return agents;
}

// --- Skill content loading (skills/*/SKILL.md, references on-demand via Read) ---

export interface SkillContent {
  prompt: string;        // SKILL.md body only (core workflow instructions)
  referencesDir: string; // absolute path for on-demand Read access
}

export async function loadSkillContents(skillsDir: string): Promise<Record<string, SkillContent>> {
  const skills: Record<string, SkillContent> = {};

  try {
    await fs.access(skillsDir);
  } catch {
    return skills;
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

  for (const dir of dirs) {
    const skillDir = path.join(skillsDir, dir.name);
    const skillFile = path.join(skillDir, "SKILL.md");

    try {
      await fs.access(skillFile);
    } catch {
      continue;
    }

    // Skill name = directory name
    const name = dir.name;
    let promptText = await fs.readFile(skillFile, "utf-8");

    // Translate all Claude Code skill path variants to the actual skill directory
    // Covers: ${CLAUDE_SKILL_DIR}, ~/.claude/skills/<x>/, $HOME/.claude/skills/<x>/, .claude/skills/<x>/
    promptText = promptText.replaceAll("${CLAUDE_SKILL_DIR}", skillDir);
    promptText = promptText.replace(/~\/\.claude\/skills\/[^/\s]+\//g, skillDir + "/");
    promptText = promptText.replace(/\$HOME\/\.claude\/skills\/[^/\s]+\//g, skillDir + "/");
    promptText = promptText.replace(/\.claude\/skills\/[^/\s]+\//g, skillDir + "/");

    // Collect subdirectory names for the reference path hint
    const subDirs: string[] = [];
    for (const sub of ["references", "assets", "templates", "resources"]) {
      try {
        const entries = await fs.readdir(path.join(skillDir, sub));
        if (entries.length > 0) subDirs.push(sub);
      } catch { /* skip missing */ }
    }

    // Detect scripts/ directory for executable skill workflows
    let scriptsHint = "";
    try {
      const scriptEntries = await fs.readdir(path.join(skillDir, "scripts"));
      if (scriptEntries.length > 0) {
        scriptsHint = `\n\n## Skill Scripts Path\n` +
          `Scripts for this skill: ${skillDir}/scripts/\n` +
          `If documentation references ".claude/skills/..." paths, use the path above instead.`;
      }
    } catch { /* no scripts dir */ }

    // Build final prompt with reference materials and scripts hint
    let finalPrompt = promptText;
    if (subDirs.length > 0) {
      finalPrompt += `\n\n## Reference Materials\n` +
        `Detailed references are available on disk. Use the Read tool when needed:\n` +
        subDirs.map(d => `- ${skillDir}/${d}/`).join("\n");
    }
    finalPrompt += scriptsHint;

    skills[name] = {
      prompt: finalPrompt,
      referencesDir: skillDir,
    };
  }

  return skills;
}
