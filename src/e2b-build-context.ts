import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const E2B_BUILD_INPUTS = [
  "package.json",
  "dist",
  "skills",
  "agents",
  "e2b/python-runtime",
] as const;

const SKIPPED_ENTRY_NAMES = new Set(["__pycache__", ".DS_Store", ".git"]);

export async function prepareE2BFileContext(rootDir: string): Promise<string> {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentos-e2b-context-"));

  for (const relativePath of E2B_BUILD_INPUTS) {
    const sourcePath = path.join(rootDir, relativePath);
    const targetPath = path.join(stagingDir, relativePath);
    await copySanitizedPath(sourcePath, targetPath);
  }

  return stagingDir;
}

async function copySanitizedPath(sourcePath: string, targetPath: string): Promise<void> {
  const stat = await fs.lstat(sourcePath);

  if (stat.isDirectory()) {
    await fs.mkdir(targetPath, { recursive: true });
    await fs.chmod(targetPath, stat.mode & 0o777);
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkipEntry(entry.name)) {
        continue;
      }
      await copySanitizedPath(path.join(sourcePath, entry.name), path.join(targetPath, entry.name));
    }
    return;
  }

  if (!stat.isFile()) {
    throw new Error(`Unsupported E2B build input type: ${sourcePath}`);
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const content = await fs.readFile(sourcePath);
  await fs.writeFile(targetPath, content);
  await fs.chmod(targetPath, stat.mode & 0o777);
}

function shouldSkipEntry(name: string): boolean {
  return SKIPPED_ENTRY_NAMES.has(name) || name.startsWith("._");
}
