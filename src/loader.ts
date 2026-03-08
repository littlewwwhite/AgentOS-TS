// input: skills/ directory containing SKILL.md files with YAML frontmatter
// output: Parsed skill definitions ready for buildAgents()
// pos: Bridge — maps declarative skill files to AgentDefinition configs

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";

import type { SkillFrontmatter } from "./agents.js";

export interface LoadedSkill extends SkillFrontmatter {
  prompt: string;
}

function parseSkill(text: string): [Record<string, unknown>, string] {
  if (!text.startsWith("---")) return [{}, text];
  const parts = text.split("---", 3);
  if (parts.length < 3) return [{}, text];
  const frontmatter = yaml.parse(parts[1]) ?? {};
  return [frontmatter, parts[2].trim()];
}

async function loadTemplates(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir);
    if (entries.length === 0) return null;
    const parts: string[] = [];
    for (const name of entries.sort()) {
      const filePath = path.join(dir, name);
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        const content = await fs.readFile(filePath, "utf-8");
        parts.push(`### ${name}\n\`\`\`json\n${content}\n\`\`\``);
      }
    }
    return parts.length > 0 ? parts.join("\n\n") : null;
  } catch {
    return null;
  }
}

async function loadReferences(dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir);
    const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
    if (mdFiles.length === 0) return null;
    const parts: string[] = [];
    for (const name of mdFiles) {
      const content = await fs.readFile(path.join(dir, name), "utf-8");
      parts.push(`## ${name}\n\n${content}`);
    }
    return parts.join("\n\n---\n\n");
  } catch {
    return null;
  }
}

async function findSkillFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  return results.sort();
}

export async function loadSkills(skillsDir: string): Promise<Record<string, LoadedSkill>> {
  const skills: Record<string, LoadedSkill> = {};

  try {
    await fs.access(skillsDir);
  } catch {
    return skills;
  }

  const skillFiles = await findSkillFiles(skillsDir);

  for (const skillFile of skillFiles) {
    const skillDir = path.dirname(skillFile);
    const text = await fs.readFile(skillFile, "utf-8");
    const [fm, body] = parseSkill(text);

    const name = fm.name as string | undefined;
    if (!name) continue;

    let prompt = body;

    // Load templates (assets/ or templates/)
    let assetsDir = path.join(skillDir, "assets");
    try {
      await fs.access(assetsDir);
    } catch {
      assetsDir = path.join(skillDir, "templates");
    }
    const assets = await loadTemplates(assetsDir);
    if (assets) {
      prompt += `\n\n## Reference Templates\n${assets}`;
    }

    // Load references
    const references = await loadReferences(path.join(skillDir, "references"));
    if (references) {
      prompt += `\n\n## Reference Documents\n${references}`;
    }

    // Load resources
    const resources = await loadReferences(path.join(skillDir, "resources"));
    if (resources) {
      prompt += `\n\n## Shared Resources\n${resources}`;
    }

    skills[name] = {
      name,
      description: (fm.description as string) ?? "",
      prompt,
      allowedTools: (fm["allowed-tools"] as string[]) ?? undefined,
      disallowedTools: (fm["disallowed-tools"] as string[]) ?? undefined,
      mcpServers: (fm["mcp-servers"] as string[]) ?? undefined,
      maxTurns: (fm["max-turns"] as number) ?? undefined,
      model: (fm.model as string) ?? undefined,
    };
  }

  return skills;
}
