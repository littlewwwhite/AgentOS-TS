import { useState, type ReactNode } from "react";
import type { StageStatus } from "../../types";
import { StatusBadge } from "./StatusBadge";

interface Props {
  label: string;
  status?: StageStatus;
  unread?: number;
  expandable?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  pendingLabel?: string;
  onClick?: () => void;
  children?: ReactNode;
}

export function StageNode({ label, status, unread, expandable, defaultOpen = false, disabled = false, pendingLabel = "未开始", onClick, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const hasRowAction = !!onClick;
  function handleRowClick() {
    if (disabled) return;
    if (hasRowAction) onClick?.();
    else if (expandable) setOpen(!open);
  }
  return (
    <div>
      <div
        className={
          "group flex items-center gap-2 px-4 py-2 text-[13px] font-medium tracking-[0.02em] transition-colors " +
          (disabled
            ? "cursor-default text-[var(--color-ink-faint)]"
            : "cursor-pointer text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)]")
        }
        onClick={handleRowClick}
      >
        <span>{label}</span>
        <StatusBadge status={status} unread={unread} />
        {disabled && !status && (
          <span className="ml-auto font-sans text-[10px] text-[var(--color-ink-faint)]">{pendingLabel}</span>
        )}
        {expandable && !disabled && (
          <span
            className="font-mono text-[10px] text-[var(--color-ink-faint)] select-none w-3 text-right"
            onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
            aria-hidden
          >{open ? "−" : "+"}</span>
        )}
      </div>
      {expandable && !disabled && open && (
        <div className="ml-4 border-l border-[var(--color-rule)]">{children}</div>
      )}
    </div>
  );
}
