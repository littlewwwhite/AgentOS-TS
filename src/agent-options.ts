// input: Base SDK options, agent directory, project path, agent name
// output: SDK-compatible options with per-agent cwd + workspace snapshot (orchestrator MCP stripped)
// pos: Shared factory — single source of truth for agent session options

import path from "node:path";
import { describeWorkspace } from "./options.js";
import { buildWorkerSessionSpec, type WorkerManifest } from "./session-specs.js";

export async function buildAgentOptions(
  baseOptions: Record<string, unknown>,
  agentsDir: string,
  projectPath: string,
  agentName: string,
  extraMcpServers?: Record<string, unknown>,
  manifest?: WorkerManifest,
): Promise<Record<string, unknown>> {
  const {
    systemPrompt: _orchestratorPrompt,
    mcpServers: rawMcp,
    agents: _agents,
    agent: _agent,
    allowedTools: _allowedTools,
    disallowedTools: _disallowedTools,
    permissionMode: _permissionMode,
    hooks: _hooks,
    ...rest
  } = baseOptions;
  // Strip orchestrator's `switch` server so agents never inherit `switch_to_agent`
  const { switch: _switchServer, ...baseMcp } = (rawMcp as Record<string, unknown>) ?? {};
  const mcpServers = {
    ...baseMcp,
    ...extraMcpServers,
  };

  // Snapshot workspace state so the agent knows what artifacts exist
  const workspaceDesc = await describeWorkspace(projectPath);
  const workerManifest = manifest ?? {
    name: agentName,
    description: "",
    skills: [],
    mcpServers: [],
  };
  const spec = await buildWorkerSessionSpec({
    projectPath,
    agentsDir,
    agentName,
    manifest: workerManifest,
    workspaceDescription: workspaceDesc,
  });

  return {
    ...rest,
    cwd: spec.cwd ?? path.resolve(agentsDir, agentName),
    settingSources: spec.settingSources,
    permissionMode: spec.permissionMode,
    mcpServers,
    systemPrompt: spec.systemPrompt,
  };
}
