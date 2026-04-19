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
  const [expanded, setExpanded] = useState(false);
  const path = extractPath(toolInput);
  const output = toolOutput ?? "";
  const overflows = output.length > 240 || output.split("\n").length > 4;
  const borderClass = isFirst ? "" : "border-t border-[var(--color-rule)] pt-6";

  return (
    <div className={`flex flex-col gap-1.5 ${borderClass}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[12px] text-[var(--color-accent)]">→</span>
        <span className="text-[13px] font-semibold text-[var(--color-ink)]">{toolName}</span>
        {path && (
          <span className="font-mono text-[11px] text-[var(--color-ink-subtle)] truncate">{path}</span>
        )}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
          {isStreaming ? "running" : formatTime(timestamp)}
        </span>
      </div>
      {output && (
        <div className="ml-5">
          <pre
            className={
              "font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)] bg-[var(--color-paper-sunk)] px-3 py-2 whitespace-pre-wrap break-words " +
              (expanded ? "" : "max-h-[120px] overflow-hidden")
            }
          >
            {output}
          </pre>
          {overflows && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)] hover:text-[var(--color-ink)] transition-colors"
            >
              Show more
            </button>
          )}
          {expanded && overflows && (
            <button
              onClick={() => setExpanded(false)}
              className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)] transition-colors"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
