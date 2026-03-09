// input: Tool call events with agentID from SDK
// output: Allow/deny decisions based on workspace boundary + per-agent file policies
// pos: Authorization boundary — enforces agent-level read/write isolation, including Bash

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

/**
 * Check if a resolved file path is inside (or equal to) the workspace root.
 */
export function isInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(workspaceRoot);
  return resolved === root || resolved.startsWith(root + path.sep);
}

// --- Bash write-target extraction ---

// Matches shell redirections: >, >>, 1>, 2>, &>
const REDIRECT_RE = /(?:>>|[12&]?>)\s*(\S+)/g;

// Commands that write to their last positional argument(s)
const WRITE_CMDS: Record<string, "last" | "all-but-first"> = {
  tee: "all-but-first",
  cp: "last",
  mv: "last",
  rm: "all-but-first",
  touch: "all-but-first",
  mkdir: "all-but-first",
};

/**
 * Best-effort extraction of filesystem write targets from a Bash command string.
 * Returns workspace-relative or absolute paths that the command would write to.
 */
export function extractBashWriteTargets(command: string): string[] {
  const targets: string[] = [];

  // 1) Redirections
  for (const m of command.matchAll(REDIRECT_RE)) {
    const target = m[1].replace(/^["']|["']$/g, "");
    if (target && !target.startsWith("/dev/")) targets.push(target);
  }

  // 2) Known write commands — simple tokenizer (doesn't handle all quoting, but good enough)
  // Split by common shell operators first, then process each simple command
  const simpleCommands = command.split(/[;&|]+/).map((s) => s.trim());
  for (const cmd of simpleCommands) {
    // Strip redirections for argument parsing
    const stripped = cmd.replace(REDIRECT_RE, "").trim();
    const tokens = stripped.split(/\s+/).filter((t) => !t.startsWith("-"));
    if (tokens.length < 2) continue;

    const bin = tokens[0].replace(/^.*\//, ""); // basename
    const mode = WRITE_CMDS[bin];
    if (!mode) continue;

    const args = tokens.slice(1);
    if (mode === "last" && args.length >= 2) {
      targets.push(args[args.length - 1]);
    } else if (mode === "all-but-first") {
      targets.push(...args);
    }
  }

  return targets;
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

    // --- Bash interception ---
    if (toolName === "Bash") {
      const command = (input.command as string) ?? "";
      const writeTargets = extractBashWriteTargets(command);

      // No write targets detected → allow (read-only shell usage)
      if (writeTargets.length === 0) return { behavior: "allow" as const };

      for (const target of writeTargets) {
        const abs = path.isAbsolute(target)
          ? path.resolve(target)
          : path.resolve(resolved, target);

        // Universal workspace boundary check
        if (!isInsideWorkspace(abs, resolved)) {
          return {
            behavior: "deny" as const,
            message: `Agent "${options.agentID}" Bash write to "${target}" escapes workspace`,
          };
        }

        // Per-agent glob check (only when policy exists)
        if (policy) {
          const rel = path.relative(resolved, abs);
          if (!policy.writable.some((p) => minimatch(rel, p))) {
            return {
              behavior: "deny" as const,
              message: `Agent "${options.agentID}" Bash cannot write "${rel}". Writable: [${policy.writable.join(", ")}]`,
            };
          }
        }
      }

      return { behavior: "allow" as const };
    }

    // --- Standard tools ---

    const filePath = extractFilePath(toolName, input);
    if (!filePath) return { behavior: "allow" as const };

    const abs = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(resolved, filePath);

    // Universal workspace boundary (applies to ALL agents)
    if (!isInsideWorkspace(abs, resolved)) {
      return {
        behavior: "deny" as const,
        message: `Agent "${options.agentID}" cannot access paths outside workspace`,
      };
    }

    // No policy = no per-agent file restrictions (but workspace boundary still enforced above)
    if (!policy) return { behavior: "allow" as const };

    const rel = path.relative(resolved, abs);

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
