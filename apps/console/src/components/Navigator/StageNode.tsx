import { useState, type ReactNode } from "react";
import type { StageStatus } from "../../types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  label: string;
  status?: StageStatus;
  unread?: number;
  expandable?: boolean;
  defaultOpen?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

export function StageNode({ label, status, unread, expandable, defaultOpen = false, onClick, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const hasRowAction = !!onClick;
  function handleRowClick() {
    if (hasRowAction) onClick?.();
    else if (expandable) setOpen(!open);
  }
  return (
    <div>
      <div
        className="group flex items-center gap-2 px-4 py-2 text-[13px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)] cursor-pointer transition-colors"
        onClick={handleRowClick}
      >
        <span>{label}</span>
        <StatusBadge status={status} unread={unread} />
        {expandable && (
          <span
            className="font-mono text-[10px] text-[var(--color-ink-faint)] select-none w-3 text-right"
            onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
            aria-hidden
          >{open ? "−" : "+"}</span>
        )}
      </div>
      {expandable && open && (
        <div className="ml-4 border-l border-[var(--color-rule)]">{children}</div>
      )}
    </div>
  );
}
