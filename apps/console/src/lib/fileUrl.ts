import { normalizeWorkspaceRelPath } from "./workspacePathContract";

export function fileUrl(projectName: string, relPath: string): string {
  const trimmed = normalizeWorkspaceRelPath(relPath);
  if (!trimmed) {
    throw new Error(`invalid workspace-relative file path: ${relPath}`);
  }
  const encoded = trimmed.split("/").map(encodeURIComponent).join("/");
  return `/files/${encodeURIComponent(projectName)}/${encoded}`;
}
