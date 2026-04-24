import { useState } from "react";
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

const SUBS: Array<{ label: string; path: (epId: string, ep?: EpisodeState) => string }> = [
  { label: "分镜", path: (id, ep) => ep?.storyboard?.artifact ?? `output/${id}/${id}_storyboard.json` },
  { label: "视频", path: (id) => `output/${id}` },
];

export function EpisodeNode({ epId, ep, unread, markSeen }: Props) {
  const [open, setOpen] = useState(false);
  const { openPath } = useTabs();
  const worstStatus = rollupEpisodeStatus(ep);
  const defaultPath = SUBS[0].path(epId, ep);

  function openDefaultStoryboard() {
    openPath(defaultPath, resolveView(defaultPath), `${epId}/${SUBS[0].label}`, { pinned: true });
    markSeen?.(defaultPath);
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={() => {
          if (!open) {
            markSeen?.(`output/${epId}`);
            openDefaultStoryboard();
          }
          setOpen(!open);
        }}
      >
        <span>{epId}</span>
        <StatusBadge status={worstStatus} unread={unread.get(`output/${epId}`)} />
        <span className="font-mono text-[10px] text-[var(--color-ink-faint)] w-3 text-right" aria-hidden>
          {open ? "−" : "+"}
        </span>
      </div>
      {open && (
        <div className="ml-4 border-l border-[var(--color-rule)]">
          {SUBS.map((sub) => {
            const p = sub.path(epId, ep);
            return (
              <div
                key={sub.label}
                onClick={() => { openPath(p, resolveView(p), `${epId}/${sub.label}`, { pinned: true }); markSeen?.(p); }}
                className="pl-4 pr-4 py-1 text-[12px] text-[var(--color-ink-subtle)] hover:bg-[var(--color-paper-soft)] cursor-pointer flex items-center gap-2 transition-colors"
              >
                <span>{sub.label}</span>
                <StatusBadge unread={unread.get(p)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
