// input: Base SDK options, agent directory, project path, agent name
// output: SDK-compatible options with per-agent cwd + settingSources (orchestrator MCP stripped)
// pos: Shared factory — single source of truth for agent session options

import path from "node:path";

export function buildAgentOptions(
  baseOptions: Record<string, unknown>,
  agentsDir: string,
  projectPath: string,
  agentName: string,
  extraMcpServers?: Record<string, unknown>,
): Record<string, unknown> {
  const { systemPrompt: _orchestratorPrompt, mcpServers: rawMcp, ...rest } = baseOptions;
  // Strip orchestrator's `switch` server so agents never inherit `switch_to_agent`
  const { switch: _switchServer, ...baseMcp } = (rawMcp as Record<string, unknown>) ?? {};
  const mcpServers = {
    ...baseMcp,
    ...extraMcpServers,
  };
  return {
    ...rest,
    agent: agentName,
    agents: undefined,
    cwd: path.resolve(agentsDir, agentName),
    settingSources: ["project"],
    mcpServers,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        `Project workspace: ${projectPath}/\n` +
        "All file operations must use absolute paths within this workspace.\n" +
        "When you complete the assigned task, call `return_to_main` with a brief summary.\n" +
        "Do NOT call return_to_main for greetings, status checks, or incomplete work.",
    },
  };
}
