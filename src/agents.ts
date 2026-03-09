// input: Agent configs (agents/*.yaml) + skill contents (skills/*/SKILL.md) + workspace path
// output: SDK AgentDefinition records
// pos: Agent factory — composes agent configs with skill content into SDK AgentDefinitions

import type { AgentConfig, SkillContent } from "./loader.js";

// --- SDK-aligned types (mirrors AgentDefinition from @anthropic-ai/claude-agent-sdk) ---

type AgentModelAlias = "sonnet" | "opus" | "haiku" | "inherit";
type AgentMcpServerSpec = string | Record<string, unknown>;

// 1:1 with SDK AgentDefinition
export interface AgentDefinitionConfig {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  mcpServers?: AgentMcpServerSpec[];
  skills?: string[];
  maxTurns?: number;
  model?: AgentModelAlias;
  configuredSkills?: string[];  // original skill names from agent config, for orchestrator routing
}


function resolveModelAlias(raw: string | undefined): AgentModelAlias | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes("sonnet")) return "sonnet";
  if (lower.includes("opus")) return "opus";
  if (lower.includes("haiku")) return "haiku";
  if (lower === "inherit") return "inherit";
  return undefined;
}

// Collect MCP server names from allowed-tools patterns (mcp__<server>__<tool>)
function collectMcpServerNames(
  allowedTools: string[] | undefined,
  explicitServers: string[] | undefined,
  toolServerMap: Record<string, unknown>,
): string[] | undefined {
  const names = new Set<string>();

  if (explicitServers) {
    for (const name of explicitServers) {
      if (name in toolServerMap) names.add(name);
    }
  }

  if (allowedTools) {
    for (const tool of allowedTools) {
      const m = tool.match(/^mcp__(\w+)__/);
      if (m && m[1] in toolServerMap) names.add(m[1]);
    }
  }

  return names.size > 0 ? [...names] : undefined;
}

/**
 * Compose agent configs with skill contents into SDK AgentDefinitions.
 *
 * Agent config (agents/*.yaml) provides: tools, model, mcpServers, maxTurns, skills list
 * Skill content (skills/SKILL.md) provides: prompt (domain knowledge + workflow)
 *
 * The agent's `skills` field references skill names → their prompts are concatenated.
 */
export function buildAgents(
  agentConfigs: Record<string, AgentConfig>,
  skillContents: Record<string, SkillContent>,
  toolServerMap: Record<string, unknown>,
  workspacePath?: string,
): Record<string, AgentDefinitionConfig> {
  const agents: Record<string, AgentDefinitionConfig> = {};

  for (const [name, config] of Object.entries(agentConfigs)) {
    const mcpServers = collectMcpServerNames(config.allowedTools, config.mcpServers, toolServerMap);

    // Compose prompt: role identity + workspace + skill knowledge
    const promptParts: string[] = [];
    promptParts.push(
      `# Role: ${name}\n\n${config.description}\n\n` +
      `You are a specialized agent in a video production pipeline. ` +
      `Stay in character — only perform tasks within your domain. ` +
      `Respond in Chinese (简体中文), use English for structural keys and code.`,
    );
    if (workspacePath) {
      promptParts.push(`Project workspace: ${workspacePath}/\nAll file operations must use absolute paths within this workspace.`);
    }
    if (config.skills) {
      // Build domain skills summary so the agent can describe its capabilities
      const skillEntries: string[] = [];
      for (const skillName of config.skills) {
        const skill = skillContents[skillName];
        if (skill) {
          promptParts.push(skill.prompt);
          const desc = skill.description || skillName;
          skillEntries.push(`- **${skillName}**: ${desc}`);
        }
      }
      if (skillEntries.length > 0) {
        promptParts.push(
          `## Domain Skills\nYour specialized capabilities in this pipeline:\n${skillEntries.join("\n")}`,
        );
      }
    }

    agents[name] = {
      description: config.description,
      prompt: promptParts.join("\n\n"),
      tools: config.allowedTools,
      disallowedTools: [...(config.disallowedTools ?? []), "Skill"],
      mcpServers,
      skills: config.skills ?? [],
      maxTurns: config.maxTurns ?? 30,
      model: resolveModelAlias(config.model),
      configuredSkills: config.skills,
    };
  }

  return agents;
}
