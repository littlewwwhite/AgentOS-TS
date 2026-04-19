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
  onDoubleClick?: () => void;
  children?: ReactNode;
}

export function StageNode({ label, status, unread, expandable, defaultOpen = false, onClick, onDoubleClick, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-[oklch(75%_0_0)] hover:bg-[oklch(14%_0_0)] cursor-pointer"
        onClick={() => { if (expandable) setOpen(!open); onClick?.(); }}
        onDoubleClick={onDoubleClick}
      >
        {expandable && <span className="text-[oklch(42%_0_0)] text-[10px]">{open ? "▾" : "▸"}</span>}
        <span>{label}</span>
        <StatusBadge status={status} unread={unread} />
      </div>
      {expandable && open && <div>{children}</div>}
    </div>
  );
}
