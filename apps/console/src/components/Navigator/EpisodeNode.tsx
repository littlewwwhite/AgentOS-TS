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
  { label: "分镜", path: (id) => `output/${id}/${id}_storyboard.json` },
  { label: "原片", path: (id) => `output/${id}` },
  { label: "剪辑", path: (id) => `output/${id}/edited` },
  { label: "配乐", path: (id) => `output/${id}/scored` },
  { label: "成片", path: (id) => `output/${id}/final` },
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
        className="flex items-center gap-2 px-4 py-1.5 text-[13px] text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={() => {
          if (!open) markSeen?.(`output/${epId}`);
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
            const p = sub.path(epId);
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
