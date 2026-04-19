// apps/console/src/components/Chat/ChatPane.tsx
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types";
import { MessageBubble } from "./MessageBubble";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  isConnected: boolean;
  onSend: (message: string) => void;
}

const SUGGESTIONS = [
  "查看所有项目状态",
  "c3 项目现在到哪个阶段了？",
  "开始 c3 的视频剪辑",
];

export function ChatPane({ messages, isStreaming, isConnected, onSend }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming || !isConnected) return;
    onSend(text);
    setInput("");
  }

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <p className="text-[oklch(40%_0_0)] text-sm">向 AgentOS 发送指令</p>
            <div className="flex flex-col gap-2 w-full max-w-xs">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  disabled={!isConnected}
                  className="text-left text-[13px] text-[oklch(55%_0_0)] border border-[oklch(22%_0_0)] rounded-xl px-4 py-2.5 hover:border-[oklch(30%_0_0)] hover:text-[oklch(70%_0_0)] transition-colors disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 输入框 */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-[oklch(20%_0_0)] px-4 py-3 flex gap-2 items-end"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder={isConnected ? "输入指令…" : "连接中…"}
          disabled={!isConnected || isStreaming}
          rows={1}
          className="flex-1 bg-[oklch(18%_0_0)] border border-[oklch(25%_0_0)] rounded-xl px-4 py-2.5 text-sm text-[oklch(88%_0_0)] placeholder-[oklch(38%_0_0)] resize-none focus:outline-none focus:border-[oklch(65%_0.18_270)] disabled:opacity-40 transition-colors"
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming || !isConnected}
          className="shrink-0 bg-[oklch(65%_0.18_270)] hover:bg-[oklch(70%_0.18_270)] text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          发送
        </button>
      </form>
    </div>
  );
}
