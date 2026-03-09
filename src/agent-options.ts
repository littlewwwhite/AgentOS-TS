// input: Base SDK options, agent directory, project path, agent name
// output: SDK-compatible options with per-agent cwd + settingSources
// pos: Shared factory — single source of truth for agent session options

import path from "node:path";

export function buildAgentOptions(
  baseOptions: Record<string, unknown>,
  agentsDir: string,
  projectPath: string,
  agentName: string,
): Record<string, unknown> {
  const { systemPrompt: _orchestratorPrompt, ...rest } = baseOptions;
  return {
    ...rest,
    agent: agentName,
    agents: undefined,
    cwd: path.resolve(agentsDir, agentName),
    settingSources: ["project"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `Project workspace: ${projectPath}/\nAll file operations must use absolute paths within this workspace.`,
    },
  };
}
