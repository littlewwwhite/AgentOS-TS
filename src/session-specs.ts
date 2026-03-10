import path from "node:path";

export interface AgentRoutingDefinition {
  description: string;
  configuredSkills?: string[];
}

export interface WorkerManifest {
  name: string;
  description: string;
  skills: string[];
  mcpServers: string[];
}

export interface SessionSpec {
  cwd: string;
  settingSources: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  hooks?: Record<string, unknown>;
  mcpServerNames: string[];
  systemPrompt: {
    type: "preset";
    preset: "claude_code";
    append: string;
  };
}

interface BuildMainSessionSpecInput {
  projectPath: string;
  agents: Record<string, AgentRoutingDefinition>;
  workspaceDescription?: string;
}

interface BuildWorkerSessionSpecInput {
  projectPath: string;
  agentsDir: string;
  agentName: string;
  manifest: WorkerManifest;
  workspaceDescription?: string;
}

export function describeAgentList(agents: Record<string, AgentRoutingDefinition>): string {
  const entries = Object.entries(agents);
  if (entries.length === 0) return "";
  return `## Sub-Agents (dispatch via switch_to_agent tool)\n${entries
    .map(([name, definition]) => {
      const skillTag = definition.configuredSkills?.length
        ? ` [skills: ${definition.configuredSkills.join(", ")}]`
        : "";
      return `- **${name}**: ${definition.description}${skillTag}`;
    })
    .join("\n")}`;
}

export async function buildMainSessionSpec(input: BuildMainSessionSpecInput): Promise<SessionSpec> {
  return {
    cwd: input.projectPath,
    settingSources: ["project"],
    allowedTools: ["TodoWrite", "mcp__switch__switch_to_agent"],
    disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit"],
    // "dontAsk": auto-approve allowedTools, silently deny everything else.
    // Main runs headless in a sandbox — "default" would hang waiting for human approval.
    permissionMode: "dontAsk",
    mcpServerNames: ["switch"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `You are a video production orchestrator.
Your ONLY job is to understand user intent and dispatch to the right sub-agent.
Do NOT perform domain work (writing scripts, generating images, etc.) yourself.

Project workspace: ${input.projectPath}/
Source materials: ${path.resolve(input.projectPath, "../data")}/
${input.workspaceDescription ?? "## Workspace\n  (empty)"}

${describeAgentList(input.agents)}

## Dispatch Rules (STRICT)
- Use the \`switch_to_agent\` tool to delegate domain tasks to specialized agents
- Delegate immediately when the request clearly belongs to a single sub-agent
- The main agent must not ask domain-specific follow-up questions when the delegated agent can ask them directly
- After delegation, conversation focus stays with that sub-agent until the user exits back to main
- Do NOT expect an automatic summary handoff back to main after each delegated task
- If user mentions a skill name, map it to the owning agent via [skills: ...] tags above
- NEVER read files under skills/ directory or run Python scripts directly
- NEVER perform domain work yourself — always delegate to the owning sub-agent
- All content in Chinese (简体中文), structural keys in English
- Use TodoWrite to show progress on multi-step tasks
- When user references a source file (e.g. '测0.txt'), copy it from source materials to workspace as source.txt, then dispatch

## Planning Requirement
Before dispatching any multi-step task:
1. Use TodoWrite to outline the plan
2. Dispatch to the sub-agent
3. Update TodoWrite as steps complete`,
    },
  };
}

export async function buildWorkerSessionSpec(
  input: BuildWorkerSessionSpecInput,
): Promise<SessionSpec> {
  return {
    cwd: path.resolve(input.agentsDir, input.agentName),
    settingSources: ["project"],
    // "bypassPermissions" auto-approves everything; settings.json deny rules (loaded via
    // settingSources: ["project"]) still override per SDK spec — effectively a deny-list model.
    // "dontAsk" would require ALL needed tools in the allow list, but current settings.json
    // files only declare MCP/Write tools, omitting common ones (Glob, Grep, Skill, Edit).
    permissionMode: "bypassPermissions",
    mcpServerNames: [...input.manifest.mcpServers],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `Project workspace: ${input.projectPath}/
All file operations must use absolute paths within this workspace.

${input.workspaceDescription ?? "## Workspace\n  (empty)"}

Stay in this agent conversation after finishing the task.
Do NOT hand control back to main automatically.
Wait for the user's next instruction unless they explicitly ask to exit the agent.`,
    },
  };
}
