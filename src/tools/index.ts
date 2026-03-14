// input: Individual tool definitions from submodules
// output: toolServers record for Options.mcpServers
// pos: Registry — packages all custom tools as in-process MCP servers

import path from "node:path";

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

import { TaskQueue, TaskQueueStore, ApiRegistry, createTaskTools } from "../task-queue/index.js";
import { EngineStore, ProjectScheduler, createCheckpointTools } from "../engine/index.js";
import { generateMusic, generateSfx, generateTts } from "./audio.js";
import { generateImage, upscaleImage } from "./image.js";
import { parseScript } from "./script-parser.js";
import { detectSourceStructure, prepareSourceProject } from "./source.js";
import { checkVideoStatus, generateVideo } from "./video.js";
import { awbGetAuth, awbLogin, awbUpload, awbSubmitTask, awbPollTask, awbApiRequest } from "./awb/index.js";
import { writeJson, readJson, saveAsset, listAssets } from "./storage.js";
import { checkWorkspace } from "./workspace.js";

// -- Task Queue singleton --

let taskQueue: TaskQueue | null = null;

export function initTaskQueue(storePath: string, apisDir: string): TaskQueue {
  if (taskQueue) return taskQueue;
  const store = new TaskQueueStore(storePath);
  const registry = new ApiRegistry(apisDir);
  taskQueue = new TaskQueue({ store, registry });
  taskQueue.resumeInFlight();
  return taskQueue;
}

export function getTaskQueue(): TaskQueue | null {
  return taskQueue;
}

function ensureTaskQueue(): TaskQueue {
  if (!taskQueue) {
    // Lazy init with defaults
    const storePath = path.join(process.cwd(), ".agentos", "tasks.db");
    const apisDir = path.resolve(import.meta.dir, "../task-queue/apis");
    initTaskQueue(storePath, apisDir);
  }
  return taskQueue!;
}

// -- Engine singleton --

let engineStore: EngineStore | null = null;
let scheduler: ProjectScheduler | null = null;

export function initEngine(storePath: string): { store: EngineStore; scheduler: ProjectScheduler } {
  if (engineStore && scheduler) return { store: engineStore, scheduler };
  engineStore = new EngineStore(storePath);
  scheduler = new ProjectScheduler(engineStore);
  return { store: engineStore, scheduler };
}

function ensureEngine(): { store: EngineStore; scheduler: ProjectScheduler } {
  if (!engineStore || !scheduler) {
    const storePath = path.join(process.cwd(), ".agentos", "engine.db");
    initEngine(storePath);
  }
  return { store: engineStore!, scheduler: scheduler! };
}

// -- Tool server builders --

const TOOL_SERVER_BUILDERS = {
  source: () => createSdkMcpServer({
    name: "source",
    tools: [prepareSourceProject, detectSourceStructure],
  }),
  image: () => createSdkMcpServer({ name: "image", tools: [generateImage, upscaleImage] }),
  video: () => createSdkMcpServer({ name: "video", tools: [generateVideo, checkVideoStatus] }),
  audio: () => createSdkMcpServer({ name: "audio", tools: [generateTts, generateSfx, generateMusic] }),
  script: () => createSdkMcpServer({ name: "script", tools: [parseScript] }),
  storage: () => createSdkMcpServer({ name: "storage", tools: [writeJson, readJson, saveAsset, listAssets] }),
  workspace: () => createSdkMcpServer({ name: "workspace", tools: [checkWorkspace] }),
  awb: () => createSdkMcpServer({
    name: "awb",
    tools: [awbGetAuth, awbLogin, awbUpload, awbSubmitTask, awbPollTask, awbApiRequest],
  }),
  tasks: () => createSdkMcpServer({ name: "tasks", tools: createTaskTools(ensureTaskQueue()) }),
  engine: () => {
    const { store, scheduler } = ensureEngine();
    return createSdkMcpServer({ name: "engine", tools: createCheckpointTools(store, scheduler) });
  },
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
