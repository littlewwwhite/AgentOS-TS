// input: project workspace root and outbound agent message
// output: agent message prefixed with server-verified project state evidence
// pos: deterministic context bridge that prevents progress replies from relying on model memory

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import {
  collectWorkspacePathViolations,
  workspacePathContractText,
} from "./workspacePathContract";

interface BuildSnapshotInput {
  projectRoot: string | null;
  userMessage: string;
}

interface BuildProjectSnapshotInput {
  projectRoot: string | null;
}

const MAX_LIST_ITEMS = 80;
const MAX_PIPELINE_CHARS = 24000;

function toRel(projectRoot: string, absPath: string): string {
  return relative(projectRoot, absPath).replace(/\\/g, "/");
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        files.push(absPath);
      }
    }
  }
  return files.sort();
}

function readPipelineState(projectRoot: string): { raw: string; data: Record<string, unknown> | null } | null {
  const path = join(projectRoot, "pipeline-state.json");
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  return { raw, data: JSON.parse(raw) as Record<string, unknown> };
}

function collectArtifactRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectArtifactRefs(item, refs);
    return refs;
  }

  const obj = value as Record<string, unknown>;
  for (const key of ["artifact", "artifacts"]) {
    const item = obj[key];
    if (typeof item === "string") refs.add(item);
    if (Array.isArray(item)) {
      for (const nested of item) {
        if (typeof nested === "string") refs.add(nested);
      }
    }
  }
  for (const item of Object.values(obj)) collectArtifactRefs(item, refs);
  return refs;
}

function collectPipelinePaths(value: unknown, refs = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectPipelinePaths(item, refs);
    return refs;
  }

  const obj = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(obj)) {
    if ((key === "artifact" || key === "path") && typeof item === "string") refs.add(item);
    if ((key === "artifacts" || key.endsWith("_paths")) && Array.isArray(item)) {
      for (const nested of item) {
        if (typeof nested === "string") refs.add(nested);
      }
    }
    collectPipelinePaths(item, refs);
  }
  return refs;
}

function collectPlayableVideos(projectRoot: string): string[] {
  return walkFiles(join(projectRoot, "output"))
    .map((path) => toRel(projectRoot, path))
    .filter((path) => /\.(?:mp4|mov|webm)$/i.test(path));
}

function formatList(items: string[], empty: string): string {
  if (items.length === 0) return empty;
  const visible = items.slice(0, MAX_LIST_ITEMS);
  const suffix = items.length > visible.length ? `\n... ${items.length - visible.length} more` : "";
  return `${visible.map((item) => `- ${item}`).join("\n")}${suffix}`;
}

export function buildServerVerifiedProjectSnapshot(input: BuildProjectSnapshotInput): string | null {
  const { projectRoot } = input;
  if (!projectRoot) return null;

  const state = readPipelineState(projectRoot);
  const pipelineJson = state?.raw
    ? JSON.stringify(JSON.parse(state.raw), null, 2).slice(0, MAX_PIPELINE_CHARS)
    : "pipeline-state.json not found";
  const artifactRefs = state?.data ? Array.from(collectArtifactRefs(state.data)).sort() : [];
  const pipelinePaths = state?.data ? Array.from(collectPipelinePaths(state.data)).sort() : [];
  const missingArtifacts = artifactRefs.filter((path) => !existsSync(join(projectRoot, path)));
  const pathViolations = collectWorkspacePathViolations(pipelinePaths)
    .map((item) => `${item.path}: ${item.reason}`);
  const playableVideos = collectPlayableVideos(projectRoot);
  const updatedAt = existsSync(join(projectRoot, "pipeline-state.json"))
    ? statSync(join(projectRoot, "pipeline-state.json")).mtime.toISOString()
    : "n/a";

  return [
    "[Server-Verified Project Snapshot]",
    "This block is authoritative runtime context captured by the console server immediately before forwarding the user request.",
    "Use it over chat memory. If it conflicts with earlier conversation, the snapshot wins.",
    "Never ask the user to paste pipeline-state.json. The active SDK session has local file tools; use Read/Bash if more detail is needed.",
    `Project root: ${projectRoot}`,
    `Snapshot updated at: ${updatedAt}`,
    "",
    workspacePathContractText(),
    "",
    "pipeline-state.json:",
    "```json",
    pipelineJson,
    "```",
    "",
    `Playable video files: ${playableVideos.length}`,
    formatList(playableVideos, "- none"),
    "",
    "Missing referenced artifacts:",
    formatList(missingArtifacts, "- none"),
    "",
    "Path contract violations:",
    formatList(pathViolations, "- none"),
    "[/Server-Verified Project Snapshot]",
  ].join("\n");
}

export function buildServerVerifiedAgentMessage(input: BuildSnapshotInput): string {
  const { projectRoot, userMessage } = input;
  const snapshot = buildServerVerifiedProjectSnapshot({ projectRoot });
  if (!snapshot) return userMessage;

  return [
    snapshot,
    "",
    "[User Request]",
    userMessage,
  ].join("\n");
}
