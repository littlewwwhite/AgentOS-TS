// input: Tool call events with agentID from SDK
// output: Allow/deny decisions based on per-agent file policies
// pos: Authorization boundary — enforces agent-level read/write isolation

import { minimatch } from "minimatch";
import path from "node:path";

export interface AgentFilePolicy {
  readable: string[];
  writable: string[];
}

const WRITE_TOOLS = new Set([
  "Write",
  "Edit",
  "mcp__storage__write_json",
  "mcp__storage__save_asset",
]);

const READ_TOOLS = new Set(["Read", "mcp__storage__read_json"]);

function extractFilePath(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === "Write" || toolName === "Read" || toolName === "Edit") {
    return (input.file_path as string) ?? null;
  }
  if (toolName.startsWith("mcp__storage__")) {
    return (input.path as string) ?? null;
  }
  return null;
}

export function createCanUseTool(
  workspaceRoot: string,
  policies: Record<string, AgentFilePolicy>,
) {
  const resolved = path.resolve(workspaceRoot);

  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: { agentID?: string },
  ) => {
    // No agentID = main orchestrator, allow everything
    if (!options.agentID) return { behavior: "allow" as const };

    const policy = policies[options.agentID];
    // No policy defined for this agent = no file restrictions
    if (!policy) return { behavior: "allow" as const };

    const filePath = extractFilePath(toolName, input);
    if (!filePath) return { behavior: "allow" as const };

    const rel = path.relative(resolved, path.resolve(resolved, filePath));

    // Block paths that escape workspace (../ prefix)
    if (rel.startsWith("..")) {
      return {
        behavior: "deny" as const,
        message: `Agent "${options.agentID}" cannot access paths outside workspace`,
      };
    }

    // Enforce write restrictions
    if (WRITE_TOOLS.has(toolName)) {
      if (!policy.writable.some((p) => minimatch(rel, p))) {
        return {
          behavior: "deny" as const,
          message: `Agent "${options.agentID}" cannot write "${rel}". Writable: [${policy.writable.join(", ")}]`,
        };
      }
    }

    // Enforce read restrictions
    if (READ_TOOLS.has(toolName)) {
      if (!policy.readable.some((p) => minimatch(rel, p))) {
        return {
          behavior: "deny" as const,
          message: `Agent "${options.agentID}" cannot read "${rel}". Readable: [${policy.readable.join(", ")}]`,
        };
      }
    }

    return { behavior: "allow" as const };
  };
}
