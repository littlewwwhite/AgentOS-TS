import type { StageStatus } from "../../types";

const COLOR: Record<StageStatus | "none", string> = {
  not_started: "oklch(30% 0 0)",
  running: "oklch(75% 0.18 260)",
  partial: "oklch(78% 0.18 80)",
  completed: "oklch(70% 0.18 145)",
  validated: "oklch(70% 0.18 145)",
  failed: "oklch(65% 0.22 25)",
  none: "transparent",
};

interface Props { status?: StageStatus | null; unread?: number; }

export function StatusBadge({ status, unread }: Props) {
  if (unread && unread > 0) {
    return (
      <span className="ml-auto text-[10px] px-1.5 rounded-full bg-[oklch(65%_0.18_270)] text-black min-w-[16px] text-center">
        {unread > 99 ? "99+" : unread}
      </span>
    );
  }
  const color = COLOR[(status ?? "none") as keyof typeof COLOR] ?? "transparent";
  if (color === "transparent") return null;
  return <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />;
}
