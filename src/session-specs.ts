// input: Project path, agents dir, agent name, manifest (skills + mcpServers)
// output: SessionSpec with cwd, settingSources, permissionMode, systemPrompt
// pos: Session configuration factory — builds orchestrator and worker session specs

import path from "node:path";

import type { ToolServerName, ToolServerSelector } from "./tools/index.js";

export interface AgentRoutingDefinition {
  description: string;
  configuredSkills?: string[];
}

export interface WorkerManifest {
  name: string;
  description: string;
  skills: string[];
  mcpServers: ToolServerName[];
}

export interface SessionSpec {
  cwd: string;
  settingSources: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  hooks?: Record<string, unknown>;
  mcpServerNames: ToolServerSelector[];
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
    allowedTools: ["TodoWrite", "mcp__source__prepare_source_project", "mcp__switch__switch_to_agent", "mcp__workspace__check_workspace"],
    disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit"],
    // "dontAsk": auto-approve allowedTools, silently deny everything else.
    // Main runs headless in a sandbox — "default" would hang waiting for human approval.
    permissionMode: "dontAsk",
    mcpServerNames: ["source", "switch", "workspace"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `You are a video production orchestrator.
Your ONLY job is to understand user intent and dispatch to the right sub-agent.
Do NOT perform domain work (writing scripts, generating images, etc.) yourself.

## Project Directory
PROJECT_DIR=${input.projectPath}

Source materials: ${path.join(input.projectPath, "data")}/

Standard layout:
- Script:    \${PROJECT_DIR}/output/script.json
- Assets:    \${PROJECT_DIR}/output/{actors,locations,props}/
- Episodes:  \${PROJECT_DIR}/output/ep{NNN}/
- Workspace: \${PROJECT_DIR}/workspace/
- Draft:     \${PROJECT_DIR}/draft/

${input.workspaceDescription ?? "## Workspace\n  (empty)"}

${describeAgentList(input.agents)}

## Dispatch Rules (STRICT)
- Use the \`switch_to_agent\` tool to delegate domain tasks to specialized agents
- Delegate immediately when the request clearly belongs to a single sub-agent
- The main agent must not ask domain-specific follow-up questions when the delegated agent can ask them directly
- After dispatching a pipeline stage, wait for the agent to return_to_main with a completion summary before proceeding to the next stage
- If user mentions a skill name, map it to the owning agent via [skills: ...] tags above
- NEVER read files under skills/ directory or run Python scripts directly
- NEVER perform domain work yourself — always delegate to the owning sub-agent
- All content in Chinese (简体中文), structural keys in English
- Use TodoWrite to show progress on multi-step tasks
- Uploaded source files live under ${path.join(input.projectPath, "data")}/ by default
- Use the \`prepare_source_project\` tool to normalize a referenced novel into ${input.projectPath}/<novel-name>/source.txt before dispatch
- Do NOT use Bash or direct file-edit tools to copy source novels yourself

## Production Pipeline (full lifecycle)

When the user requests full video production (e.g. "把这本小说做成视频", "全量制作", "完整流水线"):

1. **SCRIPT** → screenwriter (script-adapt or script-writer)
   - Output: \${PROJECT_DIR}/output/script.json
   - Gate: check_workspace("output") confirms script.json exists

2. **ASSETS + UPLOAD** → art-director (asset-gen)
   - Input: \${PROJECT_DIR}/output/script.json
   - Output: \${PROJECT_DIR}/output/{actors,locations,props}/
   - Note: use \`--create-subjects\` flag to auto-upload + create AWB subjects
   - Gate: check_workspace("output") confirms actors/ exists with element_id

3. **VIDEO GENERATION** → footage-producer (storyboard-generate)
   - Input: script.json + assets
   - Output: \${PROJECT_DIR}/output/ep{NNN}/scn{NNN}/clip{NNN}/*.mp4
   - Note: storyboard-generate handles prompt gen + batch video gen + Gemini review internally
   - Gate: check_workspace("output") confirms mp4 files

4. **VIDEO EDITING** → post-processor (video-editing)
   - Input: video clips from step 3
   - Output: \${PROJECT_DIR}/output/editing/ep{NNN}/ep{NNN}.mp4 + ep{NNN}.xml
   - Note: three-phase AI editing: scene analysis → loop editing → EP merge

5. **POST-PRODUCTION** → post-processor (music-matcher + subtitle-maker)
   - Input: edited videos
   - Output: \${PROJECT_DIR}/output/final/

After each agent returns via return_to_main, use check_workspace to verify
outputs before dispatching the next stage. Adjust plan based on actual results.
If an agent reports failure, decide whether to retry or skip.

## Planning Requirement
Before dispatching any multi-step task:
1. Use TodoWrite to outline the plan
2. Prepare the source project when the task references an uploaded novel file
3. Dispatch to the sub-agent
4. Update TodoWrite as steps complete`,
    },
  };
}

export async function buildWorkerSessionSpec(
  input: BuildWorkerSessionSpecInput,
): Promise<SessionSpec> {
  return {
    cwd: path.resolve(input.agentsDir, input.agentName),
    // settingSources: ["project"] loads CLAUDE.md, settings.json, AND .claude/skills/*.md
    // from <cwd>/.claude/ — the SDK's native skill discovery mechanism.
    // Skills require "Skill" in settings.json allow list to be discoverable.
    settingSources: ["project"],
    // "bypassPermissions" auto-approves everything; settings.json deny rules (loaded via
    // settingSources: ["project"]) still override per SDK spec — effectively a deny-list model.
    permissionMode: "bypassPermissions",
    mcpServerNames: [...input.manifest.mcpServers],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `## Project Directory
PROJECT_DIR=${input.projectPath}

All file operations must use absolute paths.
When SKILL.md commands reference \${PROJECT_DIR}, substitute with the absolute path above.

Standard layout:
- Script:    ${input.projectPath}/output/script.json
- Assets:    ${input.projectPath}/output/{actors,locations,props}/
- Episodes:  ${input.projectPath}/output/ep{NNN}/
- Workspace: ${input.projectPath}/workspace/
- Draft:     ${input.projectPath}/draft/

${input.workspaceDescription ?? "## Workspace\n  (empty)"}

When a skill is loaded, execute it to completion — run through ALL phases sequentially.
Only pause at explicit user-confirmation checkpoints (e.g. CP1/CP2) if the task description includes "需要确认" or similar.
Otherwise, use your best judgment at checkpoints and continue automatically.

Stay in this agent conversation after finishing the task.
Do NOT hand control back to main automatically.
Wait for the user's next instruction unless they explicitly ask to exit the agent.

However, when your task is dispatched from the main orchestrator (via switch_to_agent),
override the above: execute the task to completion, then call return_to_main with a
structured summary of what was completed:
- Format: "[STAGE_RESULT] status=success|partial|failed; outputs=<file list>; issues=<if any>"`,
    },
  };
}
