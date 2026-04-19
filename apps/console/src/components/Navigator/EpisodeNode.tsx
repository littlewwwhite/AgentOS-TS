import { useState } from "react";
import type { EpisodeState, StageStatus } from "../../types";
import { StatusBadge } from "./StatusBadge";
import { useTabs } from "../../contexts/TabsContext";
import { resolveView } from "../Viewer/resolveView";

interface Props {
  epId: string;
  ep: EpisodeState | undefined;
  unread: Map<string, number>;
  markSeen?: (path: string) => void;
}

const SUBS: Array<{ label: string; path: (epId: string) => string }> = [
  { label: "Storyboard", path: (id) => `output/${id}/${id}_storyboard.json` },
  { label: "Raw", path: (id) => `output/${id}` },
  { label: "Edited", path: (id) => `output/${id}/edited` },
  { label: "Scored", path: (id) => `output/${id}/scored` },
  { label: "Final", path: (id) => `output/${id}/final` },
];

const STATUS_PRIORITY: StageStatus[] = [
  "failed",
  "running",
  "partial",
  "not_started",
  "completed",
  "validated",
];

function rollupStatus(ep: EpisodeState | undefined): StageStatus {
  if (!ep) return "not_started";
  const present = [ep.storyboard, ep.video, ep.editing, ep.music, ep.subtitle]
    .map((s) => s?.status)
    .filter((s): s is StageStatus => !!s);
  if (present.length === 0) return "not_started";
  return STATUS_PRIORITY.find((p) => present.includes(p)) ?? "not_started";
}

export function EpisodeNode({ epId, ep, unread, markSeen }: Props) {
  const [open, setOpen] = useState(false);
  const { openPath } = useTabs();
  const worstStatus = rollupStatus(ep);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-1 text-[12px] text-[oklch(75%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
        onClick={() => {
          if (!open) markSeen?.(`output/${epId}`);
          setOpen(!open);
        }}
      >
        <span className="text-[oklch(42%_0_0)] text-[10px]">{open ? "▾" : "▸"}</span>
        <span>{epId}</span>
        <StatusBadge status={worstStatus} unread={unread.get(`output/${epId}`)} />
      </div>
      {open && SUBS.map((sub) => {
        const p = sub.path(epId);
        return (
          <div
            key={sub.label}
            onClick={() => { openPath(p, resolveView(p), `${epId}/${sub.label}`, { pinned: true }); markSeen?.(p); }}
            className="pl-10 pr-3 py-1 text-[12px] text-[oklch(55%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer flex items-center gap-2"
          >
            {sub.label}
            <StatusBadge unread={unread.get(p)} />
          </div>
        );
      })}
    </div>
  );
}
