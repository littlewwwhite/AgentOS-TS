export function fileUrl(projectName: string, relPath: string): string {
  const trimmed = relPath.replace(/^\/+/, "");
  const encoded = trimmed.split("/").map(encodeURIComponent).join("/");
  return `/files/${encodeURIComponent(projectName)}/${encoded}`;
}
