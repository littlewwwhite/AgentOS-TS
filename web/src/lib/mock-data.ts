// input: Mock file tree and messages for development
// output: Realistic sample data matching actual workspace structure
// pos: Development fixture — removed when API layer is connected

import type { FileNode, ChatMessage, AgentStatus } from "./types";

export const MOCK_FILE_TREE: FileNode[] = [
  {
    name: "source.txt",
    path: "source.txt",
    type: "file",
    status: "done",
  },
  {
    name: "design.json",
    path: "design.json",
    type: "file",
    status: "done",
  },
  {
    name: "catalog.json",
    path: "catalog.json",
    type: "file",
    status: "done",
  },
  {
    name: "draft",
    path: "draft",
    type: "directory",
    status: "done",
    children: [
      {
        name: "episodes",
        path: "draft/episodes",
        type: "directory",
        status: "done",
        children: Array.from({ length: 12 }, (_, i) => ({
          name: `ep${String(i + 1).padStart(2, "0")}.md`,
          path: `draft/episodes/ep${String(i + 1).padStart(2, "0")}.md`,
          type: "file" as const,
          status: "done" as const,
        })),
      },
    ],
  },
  {
    name: "assets",
    path: "assets",
    type: "directory",
    status: "active",
    children: [
      { name: "manifest.json", path: "assets/manifest.json", type: "file", status: "done" },
      { name: "subjects.json", path: "assets/subjects.json", type: "file", status: "done" },
      {
        name: "characters",
        path: "assets/characters",
        type: "directory",
        status: "active",
        children: [
          { name: "chenwei.png", path: "assets/characters/chenwei.png", type: "file", status: "done" },
          { name: "linjia.png", path: "assets/characters/linjia.png", type: "file", status: "done" },
          { name: "zhangming.png", path: "assets/characters/zhangming.png", type: "file", status: "active" },
          { name: "suyan.png", path: "assets/characters/suyan.png", type: "file", status: "pending" },
        ],
      },
      {
        name: "locations",
        path: "assets/locations",
        type: "directory",
        status: "pending",
        children: [
          { name: "office.png", path: "assets/locations/office.png", type: "file", status: "pending" },
          { name: "cafe.png", path: "assets/locations/cafe.png", type: "file", status: "pending" },
        ],
      },
    ],
  },
  {
    name: "production",
    path: "production",
    type: "directory",
    status: "pending",
    children: [
      { name: "plan.json", path: "production/plan.json", type: "file", status: "pending" },
    ],
  },
  {
    name: "output",
    path: "output",
    type: "directory",
    status: "pending",
    children: [
      { name: "script.json", path: "output/script.json", type: "file", status: "done" },
      {
        name: "clips",
        path: "output/clips",
        type: "directory",
        status: "pending",
        children: [],
      },
    ],
  },
  {
    name: "editing",
    path: "editing",
    type: "directory",
    status: "pending",
    children: [
      { name: "audio_plan.json", path: "editing/audio_plan.json", type: "file", status: "pending" },
    ],
  },
  {
    name: "audio",
    path: "audio",
    type: "directory",
    status: "pending",
    children: [],
  },
];

export const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: "1",
    role: "user",
    content: "Generate character portraits for all 13 actors in the script",
    timestamp: Date.now() - 180_000,
  },
  {
    id: "2",
    role: "agent",
    agent: "image-create",
    content: "Starting character portrait generation. Found 13 actors in script.json.\n\nProcessing in batch: 4 concurrent requests...\n\n1. chenwei.png - Corporate executive, 40s, sharp suit\n2. linjia.png - Software engineer, late 20s, casual smart\n3. zhangming.png - In progress...",
    timestamp: Date.now() - 120_000,
  },
  {
    id: "3",
    role: "system",
    content: "image-create: 2/13 completed, 1 in progress",
    timestamp: Date.now() - 60_000,
  },
];

export const MOCK_AGENTS: AgentStatus[] = [
  { name: "script-writer", state: "done" },
  { name: "script-adapt", state: "done" },
  { name: "image-create", state: "working", progress: "3/13 characters" },
  { name: "image-edit", state: "idle" },
  { name: "video-create", state: "idle" },
  { name: "video-review", state: "idle" },
  { name: "music-finder", state: "idle" },
  { name: "music-matcher", state: "idle" },
];

export const MOCK_JSON_CONTENT = JSON.stringify(
  {
    title: "Urban Echoes",
    worldview: "Contemporary urban drama set in a tech startup ecosystem",
    style: "Cinematic realism with warm color grading",
    total_episodes: 12,
    episodes: [
      {
        id: 1,
        title: "New Beginnings",
        main_plot: "Chen Wei arrives at the startup incubator",
        climax: "Discovers the company is on the verge of bankruptcy",
        cliffhanger: "A mysterious investor appears with an unusual offer",
      },
    ],
  },
  null,
  2,
);
