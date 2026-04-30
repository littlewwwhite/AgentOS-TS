import { readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { episodeIdFromStoryboardPath, episodeRuntimeDirForStoryboardPath } from "./lib/storyboardPaths";

export interface TreeNode {
  path: string;
  name: string;
  type: "dir" | "file";
  size?: number;
  mtime?: number;
}

export function safeResolve(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const rootAbs = resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + "/")) {
    throw new Error(`path escapes root: ${rel}`);
  }
  return abs;
}

export interface WalkOptions {
  maxDepth: number;
  includeDraft: boolean;
}

export function walkTree(root: string, opts: WalkOptions): TreeNode[] {
  const out: TreeNode[] = [];
  walk(root, root, 0, opts, out);
  return out;
}

function walk(root: string, dir: string, depth: number, opts: WalkOptions, out: TreeNode[]) {
  if (depth > opts.maxDepth) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!opts.includeDraft && depth === 0 && ent.name === "draft") continue;
    if (ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    const rel = relative(root, full).split("/").join("/");
    if (ent.isDirectory()) {
      out.push({ path: rel, name: ent.name, type: "dir" });
      walk(root, full, depth + 1, opts, out);
    } else if (ent.isFile()) {
      const s = statSync(full);
      out.push({ path: rel, name: ent.name, type: "file", size: s.size, mtime: s.mtimeMs });
    }
  }
}

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
};

export function mimeFor(path: string): string {
  const i = path.lastIndexOf(".");
  if (i < 0) return "application/octet-stream";
  return MIME[path.slice(i).toLowerCase()] ?? "application/octet-stream";
}

function episodeSlugFromStoryboardPath(storyboardPath: string): string {
  return episodeIdFromStoryboardPath(storyboardPath) ?? "episode";
}

export function episodePreviewPathForStoryboard(storyboardPath: string): string {
  const dir = episodeRuntimeDirForStoryboardPath(storyboardPath);
  const slug = episodeSlugFromStoryboardPath(storyboardPath);
  return dir ? `${dir}/${slug}.mp4` : `${slug}.mp4`;
}
