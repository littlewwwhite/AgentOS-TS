import type { TreeNode } from "../types";

export interface WorkspaceFile {
  path: string;
  name: string;
  size?: number;
}

export interface WorkspaceSummary {
  rootPath: string;
  sourceFiles: WorkspaceFile[];
  draftCount: number;
  outputCount: number;
  controlFiles: WorkspaceFile[];
  totalFiles: number;
}

function toWorkspaceFile(node: TreeNode): WorkspaceFile {
  return { path: node.path, name: node.name, size: node.size };
}

function comparePath(left: WorkspaceFile, right: WorkspaceFile): number {
  if (left.path === "source.txt") return -1;
  if (right.path === "source.txt") return 1;
  return left.path.localeCompare(right.path);
}

export function buildWorkspaceSummary(projectName: string, tree: TreeNode[]): WorkspaceSummary {
  const files = tree.filter((node) => node.type === "file");
  const sourceFiles = files
    .filter((node) => node.path === "source.txt" || node.path.startsWith("input/"))
    .map(toWorkspaceFile)
    .sort(comparePath);
  const controlFiles = files
    .filter((node) => node.path === "pipeline-state.json")
    .map(toWorkspaceFile)
    .sort(comparePath);

  return {
    rootPath: `workspace/${projectName}`,
    sourceFiles,
    draftCount: files.filter((node) => node.path.startsWith("draft/")).length,
    outputCount: files.filter((node) => node.path.startsWith("output/")).length,
    controlFiles,
    totalFiles: files.length,
  };
}
