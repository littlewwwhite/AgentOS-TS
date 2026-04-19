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
  const { role, content, toolName, isStreaming, timestamp } = message;

  if (toolName) return <ToolCard message={message} isFirst={isFirst} />;

  const isUser = role === "user";
  const borderClass = isFirst ? "" : "border-t border-[var(--color-rule)] pt-6";

  return (
    <div className={`flex flex-col gap-1 ${borderClass} ${isUser ? "items-end" : "items-start"}`}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
        {formatTime(timestamp)}
      </span>
      <div className={`max-w-[52ch] text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap break-words ${isUser ? "text-right" : ""}`}>
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
