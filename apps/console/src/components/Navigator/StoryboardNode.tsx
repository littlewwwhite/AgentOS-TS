// input: storyboard stage status, storyboard artifact paths, unread counts, and opener callback
// output: production navigation node for storyboard artifacts
// pos: explicit STORYBOARD stage entry between script development and video production

import { isStoryboardArtifactPath, storyboardEpisodeIdFromPath } from "../../lib/productionObject";
import type { StageStatus } from "../../types";
import { resolveView } from "../Viewer/resolveView";
import { StageNode } from "./StageNode";

interface Props {
  status?: StageStatus;
  paths: string[];
  unread: Map<string, number>;
  openPath: (path: string, view: ReturnType<typeof resolveView>, title: string, opts?: { pinned?: boolean }) => void;
  markSeen?: (path: string) => void;
}

function rankStoryboardPath(path: string): number {
  if (/^output\/storyboard\/approved\//i.test(path)) return 0;
  if (/^output\/storyboard\/draft\//i.test(path)) return 1;
  return 2;
}

function storyboardEntries(paths: string[]) {
  const byEpisode = new Map<string, string>();
  for (const path of paths.filter(isStoryboardArtifactPath)) {
    const episodeId = storyboardEpisodeIdFromPath(path) ?? path;
    const current = byEpisode.get(episodeId);
    if (!current || rankStoryboardPath(path) < rankStoryboardPath(current)) byEpisode.set(episodeId, path);
  }
  return Array.from(byEpisode.entries()).sort(([left], [right]) => left.localeCompare(right));
}

export function StoryboardNode({ status, paths, unread, openPath, markSeen }: Props) {
  const entries = storyboardEntries(paths);

  return (
    <StageNode label="故事板" status={status} expandable defaultOpen disabled={entries.length === 0} pendingLabel="待生成分集故事板">
      {entries.map(([episodeId, path]) => (
        <div
          key={episodeId}
          className="pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
          onClick={() => { openPath(path, resolveView(path), `${episodeId}/故事板`, { pinned: true }); markSeen?.(path); }}
        >
          {episodeId}
        </div>
      ))}
    </StageNode>
  );
}
