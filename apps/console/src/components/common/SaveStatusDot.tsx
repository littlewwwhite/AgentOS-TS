// input: status (idle | saving | saved | error)
// output: 6px square indicator dot with appropriate color and optional pulse
// pos: shared UI primitive displayed alongside EditableText or form fields

export interface SaveStatusDotProps {
  status: "idle" | "saving" | "saved" | "error";
  className?: string;
  /** Override default tooltip string */
  title?: string;
}

const STATUS_META: Record<
  SaveStatusDotProps["status"],
  { color: string; defaultTitle: string; pulse: boolean }
> = {
  idle: {
    color: "var(--color-ink-faint)",
    defaultTitle: "未修改",
    pulse: false,
  },
  saving: {
    color: "var(--color-warn)",
    defaultTitle: "保存中…",
    pulse: true,
  },
  saved: {
    color: "var(--color-ok)",
    defaultTitle: "已保存",
    pulse: false,
  },
  error: {
    color: "var(--color-err)",
    defaultTitle: "保存失败",
    pulse: false,
  },
};

export function SaveStatusDot({ status, className = "", title }: SaveStatusDotProps) {
  const { color, defaultTitle, pulse } = STATUS_META[status];
  const label = title ?? defaultTitle;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={[
        // 6px square (design system uses squares, not circles)
        "inline-block",
        "w-1.5 h-1.5", // 6px = 0.375rem ≈ Tailwind w-1.5
        "shrink-0",
        // Pulse only for saving state; respects prefers-reduced-motion via Tailwind
        pulse ? "animate-pulse" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundColor: color }}
    />
  );
}
