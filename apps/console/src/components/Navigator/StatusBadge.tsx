import type { StageStatus } from "../../types";

interface Props { status?: StageStatus | null; unread?: number; }

interface StatusSpec { color: string; label: string }

const MAP: Record<StageStatus, StatusSpec | null> = {
  running:     { color: "var(--color-run)",       label: "运行" },
  partial:     { color: "var(--color-warn)",      label: "部分" },
  completed:   { color: "var(--color-ok)",        label: "完成" },
  validated:   { color: "var(--color-ok)",        label: "✓" },
  failed:      { color: "var(--color-err)",       label: "失败" },
  in_review:   { color: "var(--color-run)",       label: "审核" },
  approved:    { color: "var(--color-ok)",        label: "通过" },
  locked:      { color: "var(--color-accent)",    label: "锁定" },
  change_requested: { color: "var(--color-err)",  label: "返修" },
  stale:       { color: "var(--color-warn)",      label: "失效" },
  superseded:  { color: "var(--color-ink-faint)", label: "旧版" },
  not_started: { color: "var(--color-ink-faint)", label: "—" },
};

export function getStatusBadgeSpec(status: StageStatus): StatusSpec | null {
  return MAP[status];
}

export function StatusBadge({ status, unread }: Props) {
  const spec = status ? getStatusBadgeSpec(status) : null;
  const showUnread = !!(unread && unread > 0);
  if (!spec && !showUnread) return null;
  return (
    <span className="ml-auto flex items-center gap-1.5">
      {spec && (
        <>
          <span
            className="w-[6px] h-[6px] shrink-0"
            style={{ backgroundColor: spec.color }}
            aria-hidden
          />
          <span className="font-sans text-[10px] font-semibold tracking-[0.04em] text-[var(--color-ink-subtle)]">
            {spec.label}
          </span>
        </>
      )}
      {showUnread && (
        <span
          className="w-[6px] h-[6px] rounded-full ml-1"
          style={{ backgroundColor: "var(--color-accent)" }}
          aria-label={`${unread} 条未读`}
        />
      )}
    </span>
  );
}
