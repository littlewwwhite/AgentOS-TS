// input: Absolute directory path within project workspace
// output: Recursive file listing (max 2 levels deep)
// pos: Lightweight gate tool for pipeline stage verification

import fs from "node:fs/promises";
import path from "node:path";

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export const checkWorkspace = tool(
  "check_workspace",
  "List files in a workspace directory to verify pipeline stage outputs. Returns a recursive listing (max 2 levels).",
  { path: z.string().describe("Absolute path to the directory to inspect") },
  async ({ path: dirPath }) => {
    const resolved = path.resolve(dirPath);
    try {
      const entries = await listRecursive(resolved, 0, 2);
      const summary =
        entries.length === 0
          ? "Directory is empty or does not exist"
          : `${entries.length} file(s) found`;
      return { content: [{ type: "text" as const, text: JSON.stringify({ files: entries, summary }) }] };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text" as const, text: JSON.stringify({ files: [], summary: `Cannot read directory: ${msg}` }) }] };
    }
  },
);

async function listRecursive(dir: string, depth: number, maxDepth: number): Promise<string[]> {
  if (depth >= maxDepth) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(full + "/");
      result.push(...(await listRecursive(full, depth + 1, maxDepth)));
    } else {
      result.push(full);
    }
  }
  return result;
}
