import type { ChatMessage } from "../../types";
import { ToolCard } from "./ToolCard";

interface Props {
  message: ChatMessage;
  isFirst?: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function MessageBubble({ message, isFirst }: Props) {
  const { role, content, kind, toolName, isStreaming, timestamp } = message;

  if (toolName) return <ToolCard message={message} isFirst={isFirst} />;

  const isUser = role === "user";
  const borderClass = isFirst ? "" : "border-t border-[var(--color-rule)] pt-6";

  if (kind === "thinking") {
    return (
      <div className={`flex flex-col gap-1.5 ${borderClass}`}>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
          <span>{formatTime(timestamp)}</span>
          <span>thinking</span>
        </div>
        <div className="max-w-[58ch] whitespace-pre-wrap break-words bg-[var(--color-chat-thinking)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
          {content}
          {isStreaming && (
            <span
              className="inline-block h-3 w-[2px] ml-0.5 align-middle animate-pulse"
              style={{ backgroundColor: "var(--color-accent)" }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 ${borderClass} ${isUser ? "items-end" : "items-start"}`}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
        {formatTime(timestamp)}
      </span>
      <div className={`max-w-[52ch] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap break-words ${isUser ? "bg-[var(--color-chat-user)] text-right" : "bg-[var(--color-chat-assistant)]"}`}>
        {content}
        {isStreaming && (
          <span
            className="inline-block w-[2px] h-4 ml-0.5 align-middle animate-pulse"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
        )}
      </div>
    </div>
  );
}
