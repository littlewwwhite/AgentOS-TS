import type { EpisodeState } from "../../types";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";
import { rollupEpisodeStatus } from "../../lib/episodeStatus";

interface Props {
  epId: string;
  ep: EpisodeState | undefined;
  unread: Map<string, number>;
  markSeen?: (path: string) => void;
}

function episodeDirFromRuntimeStoryboard(path: string): string | null {
  if (!/(?:^|\/)ep_?\d+_storyboard\.json$/i.test(path)) return null;
  const dir = path.split("/").slice(0, -1).join("/");
  return /(?:^|\/)ep_?\d+$/i.test(dir.split("/").pop() ?? "") ? dir : null;
}

export function episodeOpenPath(epId: string, ep: EpisodeState | undefined): string {
  const videoArtifact = ep?.video?.artifact;
  if (videoArtifact) {
    return episodeDirFromRuntimeStoryboard(videoArtifact) ?? videoArtifact;
  }
  return `output/${epId}`;
}

export function EpisodeNode({ epId, ep, unread, markSeen }: Props) {
  const { openPath } = useTabs();
  const worstStatus = rollupEpisodeStatus(ep);
  const done = worstStatus === "completed" || worstStatus === "approved" || worstStatus === "locked";

  const storyboardPath =
    ep?.storyboard?.artifact ?? `output/${epId}/${epId}_storyboard.json`;
  const videoPath = episodeOpenPath(epId, ep);

  function openEpisode() {
    openPath(videoPath, resolveView(videoPath), epId, { pinned: true });
    markSeen?.(storyboardPath);
    markSeen?.(videoPath);
  }

  return (
    <button
      type="button"
      aria-label={`打开 ${epId}`}
      className="grid w-full grid-cols-[1fr_auto] items-center gap-2 px-4 py-1.5 text-left text-[12px] transition-colors hover:bg-[var(--color-paper-soft)]"
      onClick={openEpisode}
    >
      <span className="flex min-w-0 items-center gap-1.5 font-semibold text-[var(--color-ink)]">
        {done && (
          <span className="h-1.5 w-1.5 bg-[var(--color-ok)]" aria-label="已完成" />
        )}
        <span className="truncate">{epId}</span>
      </span>
      <span className="flex items-center">
        {(unread.get(storyboardPath) || unread.get(videoPath)) && (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" aria-label="有更新" />
        )}
      </span>
    </button>
  );
}
