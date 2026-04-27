import type { EpisodeState } from "../../types";
import { StatusBadge } from "./StatusBadge";
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
  const videoPath = `output/${epId}`;

  return (
    <div
      className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
      onClick={() => {
        openPath(videoPath, resolveView(videoPath), `${epId}/视频`, { pinned: true });
        markSeen?.(videoPath);
      }}
    >
      <span>{epId}</span>
      <StatusBadge status={worstStatus} unread={unread.get(videoPath)} />
    </div>
  );
}
