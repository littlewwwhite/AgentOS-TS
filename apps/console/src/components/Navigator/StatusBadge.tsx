import type { StageStatus } from "../../types";

interface Props { status?: StageStatus | null; unread?: number; }

interface StatusSpec { color: string; label: string }

const MAP: Record<StageStatus, StatusSpec | null> = {
  running:     { color: "var(--color-run)",       label: "运行" },
  partial:     { color: "var(--color-warn)",      label: "部分" },
  completed:   { color: "var(--color-ok)",        label: "完成" },
  validated:   { color: "var(--color-ok)",        label: "✓" },
  failed:      { color: "var(--color-err)",       label: "失败" },
  not_started: { color: "var(--color-ink-faint)", label: "—" },
};

export function StatusBadge({ status, unread }: Props) {
  const spec = status ? MAP[status] : null;
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
