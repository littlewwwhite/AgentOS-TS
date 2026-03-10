import path from "node:path";

export const SANDBOX_WORKSPACE_DIR = "/home/user/app/workspace";
export const SANDBOX_SOURCE_DATA_DIR = `${SANDBOX_WORKSPACE_DIR}/data`;

export function getDefaultUploadRemotePath(localPath: string, isDirectory: boolean): string {
  if (isDirectory) return SANDBOX_SOURCE_DATA_DIR;
  return path.posix.join(SANDBOX_SOURCE_DATA_DIR, path.basename(localPath));
}
