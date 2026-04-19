// apps/console/src/components/Chat/MessageBubble.tsx
import type { ChatMessage } from "../../types";
import { ToolCard } from "./ToolCard";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const { role, content, toolName, isStreaming } = message;

  if (toolName) return <ToolCard message={message} />;

  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-[oklch(65%_0.18_270)] text-white rounded-br-sm"
            : "bg-[oklch(18%_0_0)] text-[oklch(88%_0_0)] rounded-bl-sm border border-[oklch(22%_0_0)]",
        ].join(" ")}
      >
        <span className="whitespace-pre-wrap break-words">{content}</span>
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 ml-1 bg-current opacity-70 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
