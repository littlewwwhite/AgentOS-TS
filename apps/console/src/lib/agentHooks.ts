// input: active project root
// output: Claude Agent SDK hooks for project context and workspace path enforcement
// pos: SDK hook policy boundary, kept outside orchestrator's transport adapter

import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { buildServerVerifiedProjectSnapshot } from "./agentProjectSnapshot";
import {
  auditProjectWorkspaceAfterTool,
  snapshotProjectFiles,
} from "./agentWorkspaceAudit";
import { validateGeneratedWritePath } from "./workspacePathContract";

type HookMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

const WRITE_TOOLS = new Set(["Write", "Edit"]);
const AUDITED_TOOLS = new Set(["Bash", "Write", "Edit"]);

function toolInputFilePath(input: HookInput): string | null {
  if (input.hook_event_name !== "PreToolUse") return null;
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== "object" || !("file_path" in toolInput)) return null;
  const filePath = (toolInput as { file_path?: unknown }).file_path;
  return typeof filePath === "string" ? filePath : null;
}

function allowTool(): HookJSONOutput {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
    },
  };
}

function denyTool(reason: string): HookJSONOutput {
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

export function buildAgentHooks(projectRoot: string | null): HookMap | undefined {
  if (!projectRoot) return undefined;

  const beforeToolFiles = new Map<string, Set<string>>();

  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PreToolUse") return { continue: true };
            if (AUDITED_TOOLS.has(input.tool_name)) {
              beforeToolFiles.set(input.tool_use_id, snapshotProjectFiles(projectRoot));
            }
            if (!WRITE_TOOLS.has(input.tool_name)) return { continue: true };

            const filePath = toolInputFilePath(input);
            if (!filePath) return { continue: true };

            const violation = validateGeneratedWritePath(projectRoot, input.cwd, filePath);
            return violation ? denyTool(`${violation.path}: ${violation.reason}`) : allowTool();
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PostToolUse") return { continue: true };
            const before = beforeToolFiles.get(input.tool_use_id);
            beforeToolFiles.delete(input.tool_use_id);
            if (!before || !AUDITED_TOOLS.has(input.tool_name)) return { continue: true };

            const result = auditProjectWorkspaceAfterTool({
              projectRoot,
              before,
              toolName: input.tool_name,
            });

            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: "PostToolUse",
                additionalContext: result.message ?? undefined,
              },
            };
          },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          async () => ({
            continue: true,
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: buildServerVerifiedProjectSnapshot({ projectRoot }) ?? undefined,
            },
          }),
        ],
      },
    ],
  };
}
