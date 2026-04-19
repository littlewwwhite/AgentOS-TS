import { useState } from "react";
import type { ChatMessage } from "../../types";

interface Props {
  message: ChatMessage;
  isFirst?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function extractPath(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const v = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path;
  return typeof v === "string" ? v : "";
}

export function ToolCard({ message, isFirst }: Props) {
  const { toolName, toolInput, toolOutput, isStreaming, timestamp } = message;
  // Default collapsed; output hidden until user expands
  const [open, setOpen] = useState(false);
  const path = extractPath(toolInput);
  const output = toolOutput ?? "";
  const hasOutput = output.length > 0;
  const borderClass = isFirst ? "" : "border-t border-[var(--color-rule)] pt-6";

  return (
    <div className={`flex flex-col gap-1.5 ${borderClass}`}>
      {/* Header row — entire row is a button when output is available or tool is done */}
      <button
        type="button"
        onClick={() => hasOutput && setOpen((v) => !v)}
        disabled={!hasOutput}
        className={
          "flex items-baseline gap-2 w-full text-left " +
          (hasOutput ? "cursor-pointer" : "cursor-default")
        }
        style={{ background: "none", border: "none", padding: 0 }}
      >
        <span className="font-mono text-[12px] text-[var(--color-accent)]">→</span>
        <span className="text-[13px] font-semibold text-[var(--color-ink)]">{toolName}</span>
        {path && (
          <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] truncate">{path}</span>
        )}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
          {isStreaming ? "running" : formatTime(timestamp)}
        </span>
        {/* Toggle affordance: only shown when output is available */}
        {hasOutput && (
          <span
            className="font-mono text-[10px] text-[var(--color-accent)]"
            style={{ marginLeft: 4 }}
          >
            {open ? "[−]" : "[+]"}
          </span>
        )}
      </button>

      {/* Output panel — rendered only when expanded */}
      {open && hasOutput && (
        <div className="ml-5">
          <pre className="font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)] bg-[var(--color-paper-sunk)] px-3 py-2 whitespace-pre-wrap break-words">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
