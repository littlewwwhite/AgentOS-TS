// input: active project root and before/after tool file snapshots
// output: path contract audit result and pipeline-state failure marking
// pos: post-tool safety net for files created through Bash or other generator tools

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, relative } from "path";
import {
  collectWorkspacePathViolations,
  type WorkspacePathViolation,
} from "./workspacePathContract";

export interface WorkspaceAuditInput {
  projectRoot: string;
  before: ReadonlySet<string>;
  toolName: string;
}

export interface WorkspaceAuditResult {
  violations: WorkspacePathViolation[];
  message: string | null;
}

export function snapshotProjectFiles(projectRoot: string): Set<string> {
  const files = new Set<string>();
  if (!existsSync(projectRoot)) return files;

  const stack = [projectRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.add(relative(projectRoot, absPath).replace(/\\/g, "/"));
    }
  }

  return files;
}

function markPipelineFailed(projectRoot: string, message: string): void {
  const statePath = join(projectRoot, "pipeline-state.json");
  if (!existsSync(statePath)) return;

  const state = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
  const currentStage = typeof state.current_stage === "string" ? state.current_stage : null;
  state.last_error = message;
  state.updated_at = new Date().toISOString();

  if (currentStage && state.stages && typeof state.stages === "object") {
    const stages = state.stages as Record<string, unknown>;
    const stage = stages[currentStage];
    if (stage && typeof stage === "object" && !Array.isArray(stage)) {
      (stage as Record<string, unknown>).status = "failed";
      (stage as Record<string, unknown>).updated_at = state.updated_at;
    }
  }

  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function auditProjectWorkspaceAfterTool(input: WorkspaceAuditInput): WorkspaceAuditResult {
  const after = snapshotProjectFiles(input.projectRoot);
  const created = Array.from(after).filter((path) => !input.before.has(path));
  const violations = collectWorkspacePathViolations(created);
  if (violations.length === 0) return { violations, message: null };

  const message = [
    `Path contract violation after ${input.toolName}.`,
    ...violations.map((item) => `- ${item.path}: ${item.reason}`),
  ].join("\n");
  markPipelineFailed(input.projectRoot, message);

  return { violations, message };
}
