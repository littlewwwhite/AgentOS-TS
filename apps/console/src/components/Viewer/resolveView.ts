// input: project-relative artifact path
// output: viewer kind used to render the artifact
// pos: central path-to-view routing for the console workspace

import type { ViewKind } from "../../types";

export function resolveView(path: string): ViewKind {
  if (!path) return "overview";
  const base = path.split("/").pop() ?? "";
  const dotIdx = base.lastIndexOf(".");
  const ext = dotIdx >= 0 ? base.slice(dotIdx).toLowerCase() : "";

  // Leaf files by extension
  if (ext === ".mp4" || ext === ".webm" || ext === ".mov") return "video";
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp" || ext === ".gif") return "image";
  if (ext === ".srt" || ext === ".txt" || ext === ".md") return "text";
  if (ext === ".json") {
    if (base === "script.json") return "script";
    if (base.endsWith("storyboard.json")) return "storyboard";
    if (base.endsWith(".shots.json")) return "storyboard";
    return "json";
  }

  // Directory-like paths (no extension)
  const segments = path.split("/");
  const last = segments[segments.length - 1];
  if (last === "actors" || last === "locations" || last === "props") return "asset-gallery";
  if (/^ep\d+$/.test(last)) return "video-grid";
  if (last === "raw" || last === "edited" || last === "scored" || last === "final") return "video-grid";

  return "fallback";
}
