// input: PreToolUse and PostToolUse events
// output: Console log lines showing tool intent and results
// pos: Observability — makes every tool call visible in the terminal

import type { EventHook, PostToolUseHook, PreToolUseHook } from "./types.js";

// Tools whose results stay isolated (subagent context must not bleed through)
const OPAQUE_TOOLS = new Set(["Task"]);

// Tools that count as planning activity — reset the nag counter
const PLANNING_TOOLS = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);

const NAG_INTERVAL = 3;
let nagCounter = 0;

// ---------- Helpers ----------

function truncate(text: string, maxLines = 5, maxWidth = 120): string {
  const lines = text.split("\n");
  const truncated = lines.slice(0, maxLines).map((l) => l.slice(0, maxWidth));
  const suffix = lines.length > maxLines ? "\n  ..." : "";
  return truncated.map((l) => `  | ${l}`).join("\n") + suffix;
}

function extractResponseText(response: unknown): string {
  if (typeof response === "string") return response;
  if (Array.isArray(response)) {
    return response
      .filter((item) => typeof item === "object" && item?.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
  }
  return "";
}

// ---------- PreToolUse: log intent ----------

export const logToolIntent: PreToolUseHook = async (input) => {
  const { tool_name, tool_input = {} } = input;

  if (OPAQUE_TOOLS.has(tool_name)) {
    const agent = (tool_input.description ?? tool_input.subagent_type ?? "?") as string;
    console.log(`\n  * ${agent} (skill · isolated)`);
    return {};
  }

  if (tool_name === "Bash") {
    const cmd = ((tool_input.command as string) ?? "").replace(/\n/g, "; ");
    console.log(`\n  * Bash(${cmd.slice(0, 120)})`);
    return {};
  }

  if (tool_name === "Write" || tool_name === "Read" || tool_name === "Edit") {
    const p = (tool_input.file_path ?? tool_input.path ?? "") as string;
    console.log(`\n  * ${tool_name}(${p})`);
    return {};
  }

  if (tool_name === "Glob" || tool_name === "Grep") {
    const pattern = (tool_input.pattern ?? tool_input.glob ?? "") as string;
    console.log(`\n  * ${tool_name}(${pattern})`);
    return {};
  }

  // MCP tools
  if (tool_name.startsWith("mcp__storage__write")) {
    console.log(`\n  * storage.write(${tool_input.path ?? ""})`);
    return {};
  }
  if (tool_name.startsWith("mcp__storage__")) {
    const op = tool_name.split("__").pop();
    console.log(`\n  * storage.${op}(${tool_input.path ?? tool_input.prefix ?? ""})`);
    return {};
  }
  if (tool_name.startsWith("mcp__image__") || tool_name.startsWith("mcp__video__") || tool_name.startsWith("mcp__audio__")) {
    const [, service, op] = tool_name.split("__");
    console.log(`\n  * ${service}.${op}`);
    const prompt = (tool_input.prompt ?? tool_input.description ?? "") as string;
    if (prompt) console.log(`  | ${prompt.slice(0, 100)}`);
    return {};
  }

  console.log(`\n  * ${tool_name}`);
  return {};
};

// ---------- PostToolUse: log result ----------

export const logToolResult: PostToolUseHook = async (input) => {
  const { tool_name, tool_response } = input;

  if (OPAQUE_TOOLS.has(tool_name) || tool_name === "TodoWrite") {
    if (PLANNING_TOOLS.has(tool_name)) nagCounter = 0;
    return {};
  }

  if (PLANNING_TOOLS.has(tool_name)) {
    nagCounter = 0;
  } else {
    nagCounter++;
  }

  // Nag reminder
  if (nagCounter >= NAG_INTERVAL && nagCounter % NAG_INTERVAL === 0) {
    return {
      additionalContext:
        "<reminder>You have run several tool calls without updating your plan. " +
        "Call TodoWrite now to reflect current progress.</reminder>",
    };
  }

  const text = extractResponseText(tool_response).trim();
  if (!text) return {};

  if (tool_name === "Bash") {
    console.log(truncate(text, 6));
  } else if (tool_name === "Read") {
    console.log(`  | ${text.split("\n").length} lines`);
  } else if (tool_name === "Glob" || tool_name === "Grep") {
    const matchCount = text.split("\n").filter((l) => l.trim()).length;
    console.log(`  | ${matchCount} matches`);
  } else if (tool_name.startsWith("mcp__storage__write")) {
    console.log("  | saved");
  } else if (tool_name.startsWith("mcp__")) {
    console.log(truncate(text, 2));
  }

  return {};
};

// ---------- UserPromptSubmit: reset nag ----------

export const todoNag: EventHook = async (_input) => {
  const wasOverdue = nagCounter >= NAG_INTERVAL;
  nagCounter = 0;

  if (wasOverdue) {
    return {
      additionalContext:
        "<reminder>In your previous turn you worked for many tool calls " +
        "without updating your plan. Please use TodoWrite to show your " +
        "current plan before continuing.</reminder>",
    };
  }
  return {};
};
