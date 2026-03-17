// input: VikingClient instance (or default singleton)
// output: MCP tool definitions for viking_find, viking_ls, viking_add
// pos: Tool layer — exposes Viking operations as MCP tools for agents

import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";

import type { VikingClient } from "../viking/index.js";
import { initViking } from "../viking/index.js";

/**
 * Create MCP tools bound to a VikingClient.
 * Falls back to the singleton when no client is provided.
 */
export function createVikingTools(client?: VikingClient) {
  const getClient = () => client ?? initViking();

  const vikingFind = tool(
    "viking_find",
    "Semantic search across indexed resources. Returns ranked results with URI, score and content snippet.",
    {
      query: z.string().describe("Natural-language search query"),
      target_uri: z
        .string()
        .optional()
        .describe("Narrow search to resources under this URI prefix"),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Max results to return (default 5)"),
    },
    async ({ query, target_uri, limit }) => {
      try {
        const options: Record<string, unknown> = { limit };
        if (target_uri) options.target_uri = target_uri;
        const results = await getClient().find(query, options);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    },
  );

  const vikingLs = tool(
    "viking_ls",
    "List resources and directories under a Viking URI.",
    {
      uri: z
        .string()
        .optional()
        .default("viking://resources/")
        .describe('URI to list (default "viking://resources/")'),
    },
    async ({ uri }) => {
      try {
        const entries = await getClient().ls(uri);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(entries) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    },
  );

  const vikingAdd = tool(
    "viking_add",
    "Register a local file path as a Viking resource so it becomes searchable.",
    {
      path: z.string().describe("Absolute file path to index"),
      reason: z
        .string()
        .optional()
        .describe("Why this resource is being added (stored as metadata)"),
      target: z
        .string()
        .optional()
        .describe("Target collection or URI namespace"),
    },
    async ({ path, reason, target }) => {
      try {
        const options: Record<string, unknown> = {};
        if (reason) options.reason = reason;
        if (target) options.target = target;
        const result = await getClient().addResource(path, options);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
        };
      }
    },
  );

  return [vikingFind, vikingLs, vikingAdd];
}
