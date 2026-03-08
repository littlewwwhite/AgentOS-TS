// input: Individual tool definitions from submodules
// output: toolServers record for Options.mcpServers
// pos: Registry — packages all custom tools as in-process MCP servers

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

import { generateMusic, generateSfx, generateTts } from "./audio.js";
import { generateImage, upscaleImage } from "./image.js";
import { parseScript } from "./script-parser.js";
import { listAssets, readJson, saveAsset, writeJson } from "./storage.js";
import { checkVideoStatus, generateVideo } from "./video.js";

export const toolServers = {
  storage: createSdkMcpServer({ name: "storage", tools: [writeJson, readJson, saveAsset, listAssets] }),
  image: createSdkMcpServer({ name: "image", tools: [generateImage, upscaleImage] }),
  video: createSdkMcpServer({ name: "video", tools: [generateVideo, checkVideoStatus] }),
  audio: createSdkMcpServer({ name: "audio", tools: [generateTts, generateSfx, generateMusic] }),
  script: createSdkMcpServer({ name: "script", tools: [parseScript] }),
};
