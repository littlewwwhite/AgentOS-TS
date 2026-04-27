// input: episode id + EpisodeState slice + unread map
// output: expandable navigator row that lists this episode's sub-stage artifacts
// pos: per-episode cluster node in the sidebar's per_episode group

import { useState } from "react";
import type { EpisodeState } from "../../types";
import { StatusBadge } from "./StatusBadge";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";
import { rollupEpisodeStatus } from "../../lib/episodeStatus";
import { buildEpisodeSubStages } from "../../lib/episodeSubStages";

interface Props {
  epId: string;
  ep: EpisodeState | undefined;
  unread: Map<string, number>;
  markSeen?: (path: string) => void;
  defaultOpen?: boolean;
}

export function EpisodeNode({ epId, ep, unread, markSeen, defaultOpen = false }: Props) {
  const { openPath } = useTabs();
  const [open, setOpen] = useState(defaultOpen);
  const worstStatus = rollupEpisodeStatus(ep);
  const rows = buildEpisodeSubStages(epId, ep);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="font-medium">{epId}</span>
        <StatusBadge status={worstStatus} />
        <span
          className="ml-auto font-mono text-[10px] text-[var(--color-ink-faint)] select-none w-3 text-right"
          aria-hidden
        >
          {open ? "−" : "+"}
        </span>
      </div>
      {open && (
        <div className="ml-4 border-l border-[var(--color-rule)]">
          {rows.map((row) => (
            <div
              key={row.stage}
              className="pl-6 pr-4 py-1 text-[12px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors flex items-center gap-2"
              onClick={() => {
                openPath(row.path, resolveView(row.path), row.title, { pinned: true });
                markSeen?.(row.path);
              }}
            >
              <span>{row.label}</span>
              <StatusBadge status={row.status} unread={unread.get(row.path)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
