import type { EpisodeState } from "../../types";
import { StatusBadge } from "./StatusBadge";
import { StageNode } from "./StageNode";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";
import { rollupEpisodeStatus } from "../../lib/episodeStatus";

interface Props {
  epId: string;
  ep: EpisodeState | undefined;
  unread: Map<string, number>;
  markSeen?: (path: string) => void;
}

export function EpisodeNode({ epId, ep, unread, markSeen }: Props) {
  const { openPath } = useTabs();
  const worstStatus = rollupEpisodeStatus(ep);

  const storyboardPath =
    ep?.storyboard?.artifact ?? `output/${epId}/${epId}_storyboard.json`;
  const videoPath = `output/${epId}`;

  function openStoryboard() {
    openPath(storyboardPath, resolveView(storyboardPath), `${epId}/分镜`, { pinned: true });
    markSeen?.(storyboardPath);
  }

  function openVideo() {
    openPath(videoPath, resolveView(videoPath), `${epId}/视频`, { pinned: true });
    markSeen?.(videoPath);
  }

  return (
    <StageNode label={epId} status={worstStatus} unread={unread.get(videoPath)} expandable defaultOpen>
      <div
        className="flex items-center gap-2 pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={openStoryboard}
      >
        <span>分镜提示词</span>
        <StatusBadge status={ep?.storyboard?.status} unread={unread.get(storyboardPath)} />
      </div>
      <div
        className="flex items-center gap-2 pl-6 pr-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={openVideo}
      >
        <span>视频</span>
        <StatusBadge status={ep?.video?.status} unread={unread.get(videoPath)} />
      </div>
    </StageNode>
  );
}
