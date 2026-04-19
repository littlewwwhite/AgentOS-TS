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
    <div className="flex flex-col h-full bg-[var(--color-paper)]">
      <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-6">
        {messages.length === 0 && (
          <div className="flex flex-col justify-center h-full gap-8">
            <div>
              <div className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
                Say something.
              </div>
              <div className="mt-2 text-[13px] text-[var(--color-ink-muted)] leading-relaxed">
                Instruct the agent in natural language. The session persists across messages.
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  disabled={!isConnected}
                  className="text-left text-[13px] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] py-1 border-b border-[var(--color-rule)] hover:border-[var(--color-accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="font-mono text-[10px] text-[var(--color-ink-faint)] mr-2">→</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={m.id} message={m} isFirst={i === 0} />
        ))}
        {/* Thinking spinner: show only when streaming but no text bubble is actively streaming */}
        {isStreaming && (() => {
          const lastMsg = messages[messages.length - 1];
          const hasActiveTextStream =
            lastMsg &&
            lastMsg.role === "assistant" &&
            !lastMsg.toolName &&
            lastMsg.isStreaming === true;
          if (hasActiveTextStream) return null;
          return (
            <div className="flex items-center gap-2 pl-1">
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  backgroundColor: "var(--color-accent)",
                  animation: "thinking-pulse 800ms ease-in-out infinite alternate",
                }}
              />
              <span
                className="font-sans text-[13px] text-[var(--color-ink-subtle)]"
                style={{ fontStyle: "italic" }}
              >
                正在思考…
              </span>
              <style>{`
                @keyframes thinking-pulse {
                  from { opacity: 0.4; }
                  to   { opacity: 1;   }
                }
              `}</style>
            </div>
          );
        })()}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={handleSubmit}
        className="border-t border-[var(--color-rule-strong)] px-5 py-4 flex gap-3 items-end bg-[var(--color-paper)]"
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
          placeholder={isConnected ? "Message…" : "Connecting…"}
          disabled={!isConnected || isStreaming}
          rows={1}
          className="flex-1 bg-[var(--color-paper-sunk)] border-0 rounded-[2px] px-3 py-2.5 text-[13px] text-[var(--color-ink)] placeholder-[var(--color-ink-faint)] resize-none focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-40"
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming || !isConnected}
          className="shrink-0 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)] hover:text-[var(--color-ink)] px-2 py-2.5 disabled:text-[var(--color-ink-faint)] disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
