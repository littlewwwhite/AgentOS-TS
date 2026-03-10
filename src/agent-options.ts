// input: Base SDK options, agent directory, project path, agent name
// output: SDK-compatible options with per-agent cwd + workspace snapshot (no MCP — freshMcpServers() provides per-query)
// pos: Shared factory — single source of truth for agent session options

import path from "node:path";
import { describeWorkspace } from "./options.js";
import { buildWorkerSessionSpec, type WorkerManifest } from "./session-specs.js";

export async function buildAgentOptions(
  baseOptions: Record<string, unknown>,
  agentsDir: string,
  projectPath: string,
  agentName: string,
  manifest?: WorkerManifest,
): Promise<Record<string, unknown>> {
  const {
    systemPrompt: _orchestratorPrompt,
    mcpServers: _mcpServers,        // stripped: freshMcpServers() provides per-query
    agents: _agents,
    agent: _agent,
    allowedTools: _allowedTools,
    disallowedTools: _disallowedTools,
    permissionMode: _permissionMode,
    resume: _resume,                // stripped: orchestrator session, not agent's
    continue: _continue,            // stripped: orchestrator flag, not agent's
    maxTurns: _maxTurns,            // stripped: agents get their own limit
    // Hooks are intentionally KEPT (passed through via ...rest).
    // Sub-agents are the ones executing domain tools — schema validation
    // and tool logging must apply to their tool calls, not just the orchestrator's.
    ...rest
  } = baseOptions;

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
    // mcpServers intentionally omitted — processQuery() calls freshMcpServers()
    // which creates properly-scoped MCP instances before every query().
    ...(spec.permissionMode === "bypassPermissions" && {
      allowDangerouslySkipPermissions: true,
    }),
    maxTurns: 200,
    systemPrompt: spec.systemPrompt,
    // Do NOT set `tools` — the SDK default includes all built-in tools plus
    // auto-discovered Skill tool.  Explicitly setting the preset may exclude
    // project-level skills loaded via settingSources: ["project"].
    // Reference: e2b-claude-agent also omits this option.
  };
}
