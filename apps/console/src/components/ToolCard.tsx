// apps/console/src/components/ToolCard.tsx
import type { ChatMessage } from "../types";

interface Props {
  message: ChatMessage;
}

export function ToolCard({ message }: Props) {
  const { toolName, toolInput, toolOutput, isStreaming } = message;

  return (
    <div className="rounded-lg border border-[oklch(22%_0_0)] bg-[oklch(14%_0_0)] overflow-hidden text-[12px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[oklch(22%_0_0)] bg-[oklch(16%_0_0)]">
        <span className="text-[oklch(65%_0.18_270)] font-mono font-semibold">{toolName}</span>
        {isStreaming && (
          <span className="text-[oklch(42%_0_0)] animate-pulse">执行中…</span>
        )}
      </div>

      {toolInput != null && (
        <div className="px-3 py-2 font-mono text-[oklch(50%_0_0)] truncate">
          {String(JSON.stringify(toolInput)).slice(0, 120)}
        </div>
      )}

      {toolOutput && (
        <div className="px-3 py-2 font-mono text-[oklch(60%_0_0)] border-t border-[oklch(22%_0_0)] max-h-24 overflow-y-auto">
          {toolOutput.slice(0, 300)}
          {toolOutput.length > 300 && "…"}
        </div>
      )}
    </div>
  );
}
