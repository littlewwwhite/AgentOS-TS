// input: Base SDK options, agent directory, project path, agent name
// output: SDK-compatible options with per-agent cwd + workspace snapshot (orchestrator MCP stripped)
// pos: Shared factory — single source of truth for agent session options

import path from "node:path";
import { describeWorkspace } from "./options.js";

export async function buildAgentOptions(
  baseOptions: Record<string, unknown>,
  agentsDir: string,
  projectPath: string,
  agentName: string,
  extraMcpServers?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { systemPrompt: _orchestratorPrompt, mcpServers: rawMcp, agents: _agents, agent: _agent, ...rest } = baseOptions;
  // Strip orchestrator's `switch` server so agents never inherit `switch_to_agent`
  const { switch: _switchServer, ...baseMcp } = (rawMcp as Record<string, unknown>) ?? {};
  const mcpServers = {
    ...baseMcp,
    ...extraMcpServers,
  };

  // Snapshot workspace state so the agent knows what artifacts exist
  const workspaceDesc = await describeWorkspace(projectPath);

  return {
    ...rest,
    cwd: path.resolve(agentsDir, agentName),
    settingSources: ["project"],
    mcpServers,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append:
        `Project workspace: ${projectPath}/\n` +
        "All file operations must use absolute paths within this workspace.\n\n" +
        `${workspaceDesc}\n\n` +
        "When you complete the assigned task, call `return_to_main` with a brief summary.\n" +
        "Do NOT call return_to_main for greetings, status checks, or incomplete work.",
    },
  };
}
