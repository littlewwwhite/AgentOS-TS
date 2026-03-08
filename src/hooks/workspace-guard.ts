// input: PreToolUse events for Write and storage tools
// output: Allow or deny based on workspace path containment
// pos: Security boundary — prevents writes outside workspace

import path from "node:path";
import type { PreToolUseHook } from "./types.js";

let workspaceRoot: string | null = null;

export function setWorkspaceRoot(rootPath: string): void {
  workspaceRoot = path.resolve(rootPath);
}

export function getWorkspaceRoot(): string | null {
  return workspaceRoot;
}

function isInsideWorkspace(filePath: string): boolean {
  if (!workspaceRoot) return true;
  const resolved = path.resolve(filePath);
  return resolved.startsWith(workspaceRoot + path.sep) || resolved === workspaceRoot;
}

export const workspaceGuard: PreToolUseHook = async (input) => {
  if (!workspaceRoot) return {};

  const { tool_name, tool_input } = input;

  // Built-in Write tool
  if (tool_name === "Write") {
    const filePath = (tool_input?.file_path as string) ?? "";
    if (filePath && !isInsideWorkspace(filePath)) {
      return {
        permissionDecision: "deny",
        reason: `Write target ${filePath} is outside workspace (${workspaceRoot})`,
      };
    }
  }

  // MCP storage writes
  if (tool_name.startsWith("mcp__storage__write") || tool_name === "mcp__storage__save_asset") {
    const p = (tool_input?.path as string) ?? "";
    if (p) {
      const resolved = path.isAbsolute(p) ? path.resolve(p) : path.resolve(workspaceRoot!, p);
      if (!isInsideWorkspace(resolved)) {
        return {
          permissionDecision: "deny",
          reason: `Storage path ${p} escapes workspace (${workspaceRoot})`,
        };
      }
    }
  }

  return {};
};
