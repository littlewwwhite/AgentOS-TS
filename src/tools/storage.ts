// input: File paths and JSON data from agents
// output: Persisted files in workspace, file listings
// pos: Foundation tool — all agents depend on this for workspace I/O

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

export const writeJson = tool(
  "write_json",
  "Write JSON data to a file in workspace",
  { path: z.string(), data: z.string() },
  async ({ path: filePath, data }) => {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), "utf-8");
    return { content: [{ type: "text" as const, text: `Written to ${filePath}` }] };
  },
);

export const readJson = tool(
  "read_json",
  "Read and parse a JSON file from workspace",
  { path: z.string() },
  async ({ path: filePath }) => {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

export const saveAsset = tool(
  "save_asset",
  "Save a binary asset file to workspace",
  { path: z.string(), url: z.string() },
  async ({ path: filePath }) => {
    return { content: [{ type: "text" as const, text: `Asset saved to ${filePath} (stub)` }] };
  },
);

export const listAssets = tool(
  "list_assets",
  "List files in a workspace directory",
  { directory: z.string() },
  async ({ directory }) => {
    try {
      const entries = await fs.readdir(directory);
      const files: string[] = [];
      for (const entry of entries.sort()) {
        const stat = await fs.stat(path.join(directory, entry));
        if (stat.isFile()) files.push(entry);
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(files) }] };
    } catch {
      return { content: [{ type: "text" as const, text: "[]" }] };
    }
  },
);
