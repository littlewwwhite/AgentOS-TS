// input: Individual tool definitions from submodules
// output: toolServers record for Options.mcpServers
// pos: Registry — packages all custom tools as in-process MCP servers

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

import { generateMusic, generateSfx, generateTts } from "./audio.js";
import { generateImage, upscaleImage } from "./image.js";
import { parseScript } from "./script-parser.js";
import { detectSourceStructure, prepareSourceProject } from "./source.js";
import { listAssets, readJson, saveAsset, writeJson } from "./storage.js";
import { checkVideoStatus, generateVideo } from "./video.js";

const TOOL_SERVER_BUILDERS = {
  source: () => createSdkMcpServer({
    name: "source",
    tools: [prepareSourceProject, detectSourceStructure],
  }),
  storage: () => createSdkMcpServer({
    name: "storage",
    tools: [writeJson, readJson, saveAsset, listAssets],
  }),
  image: () => createSdkMcpServer({ name: "image", tools: [generateImage, upscaleImage] }),
  video: () => createSdkMcpServer({ name: "video", tools: [generateVideo, checkVideoStatus] }),
  audio: () => createSdkMcpServer({ name: "audio", tools: [generateTts, generateSfx, generateMusic] }),
  script: () => createSdkMcpServer({ name: "script", tools: [parseScript] }),
} satisfies Record<string, () => unknown>;

export type ToolServerName = keyof typeof TOOL_SERVER_BUILDERS;
export type ToolServerSelector = ToolServerName | "switch";
export const TOOL_SERVER_NAMES = Object.keys(TOOL_SERVER_BUILDERS) as ToolServerName[];

export function isToolServerName(value: string): value is ToolServerName {
  return TOOL_SERVER_NAMES.includes(value as ToolServerName);
}

export function createToolServers(
  names: ToolServerSelector[] = [],
) {
  const servers: Partial<Record<ToolServerName, unknown>> = {};

  for (const name of names) {
    if (name === "switch") continue;
    servers[name] = TOOL_SERVER_BUILDERS[name]();
  }

  return servers;
}
