import fs from "node:fs/promises";
import path from "node:path";

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export { detectSourceStructure, detectSourceStructureProject } from "./source-structure.js";

export interface PreparedSourceProject {
  projectName: string;
  projectPath: string;
  originalSourcePath: string;
  sourceTextPath: string;
}

// Callback registry for projectPath updates
let _onProjectPathChanged: ((newPath: string) => void) | null = null;

export function setProjectPathCallback(cb: (newPath: string) => void): void {
  _onProjectPathChanged = cb;
}

function getWorkspaceRoot(sourcePath: string): string {
  const parentDir = path.dirname(sourcePath);
  return path.basename(parentDir) === "data" ? path.dirname(parentDir) : parentDir;
}

export async function prepareSourceProjectFile(sourcePath: string): Promise<PreparedSourceProject> {
  const resolvedSourcePath = path.resolve(sourcePath);
  const stat = await fs.stat(resolvedSourcePath);
  if (!stat.isFile()) {
    throw new Error(`Source path is not a file: ${resolvedSourcePath}`);
  }

  const projectName = path.basename(resolvedSourcePath, path.extname(resolvedSourcePath));
  const workspaceRoot = getWorkspaceRoot(resolvedSourcePath);
  const projectPath = path.join(workspaceRoot, projectName);
  const sourceTextPath = path.join(projectPath, "source.txt");

  await fs.mkdir(projectPath, { recursive: true });
  await fs.copyFile(resolvedSourcePath, sourceTextPath);

  // Notify orchestrator to update projectPath for all subsequent agent dispatches
  if (_onProjectPathChanged) {
    _onProjectPathChanged(projectPath);
  }

  return {
    projectName,
    projectPath,
    originalSourcePath: resolvedSourcePath,
    sourceTextPath,
  };
}

export const prepareSourceProject = tool(
  "prepare_source_project",
  "Normalize an uploaded novel file into <workspace>/<novel-name>/source.txt before dispatching to screenwriter. Automatically updates PROJECT_DIR for all subsequent agent dispatches.",
  { source_path: z.string() },
  async ({ source_path: sourcePath }) => {
    const prepared = await prepareSourceProjectFile(sourcePath);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(prepared, null, 2) }],
    };
  },
);
