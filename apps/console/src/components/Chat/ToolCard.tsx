// input: tool-use chat message with optional input/output payloads
// output: compact collapsible tool card for the chat transcript
// pos: renders agent tool activity without flooding the conversation

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

function artifactLabel(path: string): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function ToolCard({ message, isFirst }: Props) {
  const { toolName, toolInput, toolOutput, isStreaming, timestamp } = message;
  // Default collapsed; output hidden until user expands
  const [open, setOpen] = useState(false);
  const path = artifactLabel(extractPath(toolInput));
  const output = toolOutput ?? "";
  const hasOutput = output.length > 0;
  const borderClass = isFirst ? "" : "border-t border-[var(--color-rule)] pt-1.5";

  return (
    <div className={`flex flex-col gap-0.5 ${borderClass}`}>
      <button
        type="button"
        onClick={() => hasOutput && setOpen((v) => !v)}
        disabled={!hasOutput}
        className={
          "grid min-h-9 w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-2 border-0 bg-transparent py-1.5 text-left " +
          (hasOutput ? "cursor-pointer" : "cursor-default")
        }
      >
        <span className="flex h-6 items-center justify-center font-mono text-[11px] leading-none text-[var(--color-accent)]">
          →
        </span>

        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold leading-4 text-[var(--color-ink)]">
            {toolName}
          </span>
          {path && (
            <span className="min-w-0 truncate font-mono text-[9px] leading-4 text-[var(--color-ink-subtle)]">
              {path}
            </span>
          )}
        </span>

        <span className="flex h-6 items-center gap-1 whitespace-nowrap pl-1">
          <span className="font-mono text-[8px] tracking-[0.04em] text-[var(--color-ink-subtle)]">
            {isStreaming ? "运行中" : formatTime(timestamp)}
          </span>
          {hasOutput && (
            <span className="font-mono text-[8px] text-[var(--color-accent)]">
              {open ? "[收起]" : "[展开]"}
            </span>
          )}
        </span>
      </button>

      {open && hasOutput && (
        <div className="ml-3">
          <pre className="whitespace-pre-wrap break-words bg-[var(--color-paper-sunk)] px-1.5 py-1 font-mono text-[9px] leading-relaxed text-[var(--color-ink-muted)]">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
