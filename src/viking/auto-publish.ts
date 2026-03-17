// input: Workspace directory path, VikingClient instance
// output: scanWorkspaceChanges() for file discovery, publishArtifacts() for registration
// pos: Best-effort workspace artifact publisher — called fire-and-forget on agent return

import fs from "node:fs";
import path from "node:path";
import type { VikingClient } from "./client.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PublishMetadata {
  producer: string;
  summary: string;
}

// ---------------------------------------------------------------------------
// Workspace scanner
// ---------------------------------------------------------------------------

const SKIP_NAMES = new Set(["node_modules"]);
const SKIP_EXTENSIONS = new Set([".db", ".sqlite"]);

/**
 * Recursively walk `workspacePath` and return absolute paths of files
 * modified since `sinceMs`. Skips hidden entries, node_modules, and
 * database files. Returns empty array on any top-level error.
 */
export async function scanWorkspaceChanges(
  workspacePath: string,
  sinceMs: number,
  maxDepth = 3,
): Promise<string[]> {
  const results: string[] = [];
  try {
    walk(workspacePath, sinceMs, maxDepth, 0, results);
  } catch {
    return [];
  }
  return results;
}

function walk(
  dir: string,
  sinceMs: number,
  maxDepth: number,
  depth: number,
  out: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    // Skip hidden entries and known noisy directories
    if (entry.name.startsWith(".") || SKIP_NAMES.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (depth + 1 < maxDepth) {
        walk(full, sinceMs, maxDepth, depth + 1, out);
      }
      continue;
    }

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) continue;

      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs >= sinceMs) {
          out.push(full);
        }
      } catch {
        // Unreadable file — skip silently
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Artifact publisher
// ---------------------------------------------------------------------------

/**
 * Register each file with OpenViking. Skips hidden files.
 * Best-effort: catches per-file errors and continues.
 * Returns count of successfully registered files.
 */
export async function publishArtifacts(
  client: VikingClient,
  files: string[],
  meta: PublishMetadata,
): Promise<number> {
  let count = 0;
  for (const file of files) {
    const basename = path.basename(file);
    if (basename.startsWith(".")) continue;

    try {
      await client.addResource(file, {
        reason: `[${meta.producer}] ${meta.summary}`,
        target: `viking://resources/artifacts/${meta.producer}/`,
      });
      count++;
    } catch {
      // Best-effort: log nothing, continue with next file
    }
  }
  return count;
}
