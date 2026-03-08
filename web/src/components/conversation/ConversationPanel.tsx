// input: Chat messages and user input from conversation store
// output: Streaming chat panel with agent status indicator
// pos: Right panel — conversation interface and agent activity log

import { useRef, useEffect } from "react";
import {
  PaperPlaneRight,
  Robot,
  User,
  Info,
  SidebarSimple,
  CircleNotch,
} from "@phosphor-icons/react";
import { useStudioStore } from "@/stores/studio";
import type { ChatMessage } from "@/lib/types";

function MessageBubble({ message }: { message: ChatMessage }) {
  const roleStyles: Record<ChatMessage["role"], string> = {
    user: "bg-[var(--color-surface-2)]",
    agent: "bg-[var(--color-accent-surface)] border-l-2 border-[var(--color-accent-dim)]",
    system: "bg-transparent border border-[var(--color-border)]",
  };

  const roleIcons: Record<ChatMessage["role"], React.ReactNode> = {
    user: <User weight="bold" className="size-3.5" />,
    agent: <Robot weight="bold" className="size-3.5" />,
    system: <Info weight="bold" className="size-3.5" />,
  };

  const timeStr = new Date(message.timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`rounded-lg px-3 py-2.5 ${roleStyles[message.role]}`}>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[var(--color-text-muted)]">{roleIcons[message.role]}</span>
        {message.agent && (
          <span className="font-mono text-[11px] font-medium text-[var(--color-accent)]">
            {message.agent}
          </span>
        )}
        {message.role === "user" && (
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">You</span>
        )}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
          {timeStr}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
        {message.content}
      </p>
    </div>
  );
}

function ActiveAgentBar() {
  const agents = useStudioStore((s) => s.agents);
  const activeAgent = agents.find((a) => a.state === "working");

  if (!activeAgent) return null;

  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-accent-surface)] px-3 py-1.5">
      <CircleNotch weight="bold" className="size-3.5 animate-spin text-[var(--color-accent)]" />
      <span className="font-mono text-[12px] font-medium text-[var(--color-accent)]">
        {activeAgent.name}
      </span>
      {activeAgent.progress && (
        <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
          {activeAgent.progress}
        </span>
      )}
    </div>
  );
}

export function ConversationPanel() {
  const { messages, inputValue, isStreaming, setInput, sendMessage, toggleConversation } =
    useStudioStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--color-surface-1)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Conversation
        </span>
        <button
          type="button"
          onClick={toggleConversation}
          className="flex size-6 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-secondary)]"
        >
          <SidebarSimple weight="bold" className="size-3.5" />
        </button>
      </div>

      <ActiveAgentBar />

      {/* Messages */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 py-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 px-3 py-2 text-[var(--color-text-muted)]">
            <CircleNotch weight="bold" className="size-3.5 animate-spin" />
            <span className="text-[12px]">Thinking...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-[var(--color-border)] p-2">
        <div className="flex items-end gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-2">
          <textarea
            value={inputValue}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            className="max-h-32 min-h-[20px] flex-1 resize-none bg-transparent text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isStreaming}
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent)] text-[var(--color-surface-0)] transition-all hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <PaperPlaneRight weight="fill" className="size-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
