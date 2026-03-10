// input: PreToolUse events for mcp__storage__write_json
// output: Allow or deny based on Zod schema validation
// pos: Data integrity gate — validates JSON before it reaches disk

import { schemaRegistry } from "../schemas/index.js";
import type { PreToolUseHook } from "./types.js";

export const schemaValidator: PreToolUseHook = async (input) => {
  if (input.tool_name !== "mcp__storage__write_json") return {};

  const toolInput =
    typeof input.tool_input === "object" && input.tool_input !== null
      ? (input.tool_input as Record<string, unknown>)
      : {};
  const filePath = typeof toolInput.path === "string" ? toolInput.path : "";

  // Find matching schema by path suffix
  let matchedSchema: (typeof schemaRegistry)[string] | undefined;
  for (const [suffix, schema] of Object.entries(schemaRegistry)) {
    if (filePath.endsWith(suffix)) {
      matchedSchema = schema;
      break;
    }
  }

  if (!matchedSchema) return {};

  const rawData = toolInput.data;
  const data = typeof rawData === "string" ? JSON.parse(rawData) : rawData;

  const result = matchedSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Schema validation failed for ${filePath}: ${issues}`,
      },
    };
  }

  return {};
};
