// input: chat transcript, connection state, suggestions, and SDK slash commands
// output: composer UI with streaming-safe input, command picker, and stop control
// pos: primary user-agent conversation surface in the console

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types";
import type { ProductionObject } from "../../lib/productionObject";
import { MessageBubble } from "./MessageBubble";
import { nextSlashCommandIndex, visibleSlashCommandOptions } from "../../lib/slashCommands";
import { ScopeSummary } from "./ScopeSummary";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  isConnected: boolean;
  onSend: (message: string) => void;
  onStop?: () => void;
  suggestions: string[];
  slashCommands?: string[];
  productionObject?: ProductionObject;
}

export function ChatPane({
  messages,
  isStreaming,
  isConnected,
  onSend,
  onStop,
  suggestions,
  slashCommands = [],
  productionObject,
}: Props) {
  const [input, setInput] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(() =>
    isStreaming ? Date.now() : null,
  );
  const [now, setNow] = useState(() => Date.now());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const commandOptions = visibleSlashCommandOptions(input, slashCommands);
  const commandOptionsKey = commandOptions.map((option) => option.command).join("\n");
  const selectedCommand =
    commandOptions[Math.min(selectedCommandIndex, Math.max(commandOptions.length - 1, 0))]?.command;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [commandOptionsKey]);

  useEffect(() => {
    if (!isStreaming) {
      setStreamStartedAt(null);
      return;
    }

    setStreamStartedAt((current) => current ?? Date.now());
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  function submitCurrentInput() {
    if (!input.trim() || !isConnected) return;
    onSend(input);
    setInput("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitCurrentInput();
  }

  function insertCommand(command: string) {
    setInput(`${command} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (commandOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCommandIndex((current) => nextSlashCommandIndex(current, commandOptions.length, "down"));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCommandIndex((current) => nextSlashCommandIndex(current, commandOptions.length, "up"));
        return;
      }

      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        if (selectedCommand) insertCommand(selectedCommand);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitCurrentInput();
    }
  }

  const lastMsg = messages[messages.length - 1];
  const hasActiveAssistantStream =
    lastMsg &&
    lastMsg.role === "assistant" &&
    !lastMsg.toolName &&
    lastMsg.isStreaming === true;
  const thinkingElapsed = streamStartedAt
    ? Math.max(1, Math.floor((now - streamStartedAt) / 1000))
    : 1;

  return (
    <div className="flex flex-col h-full bg-[var(--color-paper)]">
      {productionObject && <ScopeSummary object={productionObject} />}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col justify-center h-full gap-8">
            <div>
              <div className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
                聊点什么吧。
              </div>
              <div className="mt-2 text-[13px] text-[var(--color-ink-muted)] leading-relaxed">
                用自然语言指挥代理，同一会话在多轮之间保持上下文。
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
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
        {isStreaming && !hasActiveAssistantStream && (
          <div className="flex items-center gap-2 pl-1 font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)]">
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse bg-[var(--color-accent)]"
              aria-hidden="true"
            />
            <span>正在思考</span>
            <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
              {thinkingElapsed}s
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={handleSubmit}
        className="relative border-t border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-2"
      >
        {commandOptions.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-auto bg-[var(--color-paper)] py-1 shadow-[0_12px_36px_rgba(0,0,0,0.08)] ring-1 ring-[var(--color-rule)]">
            {commandOptions.map((option, index) => {
              const active = index === selectedCommandIndex;
              return (
                <button
                  key={option.command}
                  type="button"
                  onClick={() => insertCommand(option.command)}
                  className={
                    "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors " +
                    (active ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-paper-soft)]")
                  }
                  aria-selected={active}
                >
                  <span className="font-mono text-[12px] font-semibold text-[var(--color-ink)]">
                    {option.command}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)]">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            id="agentos-chat-composer"
            aria-label="聊天输入"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={isConnected ? "说出要调整的镜头、分镜、素材或下一步…" : "连接中…"}
            disabled={!isConnected}
            rows={1}
            className="max-h-[120px] min-h-[34px] flex-1 resize-none border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink)] outline-none placeholder-[var(--color-ink-faint)] transition-colors focus:border-[var(--color-accent)] disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={!input.trim() || !isConnected}
            className="min-h-[34px] shrink-0 px-2.5 font-sans text-[11px] font-semibold text-[var(--color-ink)] transition-colors hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:text-[var(--color-ink-faint)]"
          >
            发送
          </button>
          {isStreaming && (
            <button
              type="button"
              onClick={onStop}
              disabled={!isConnected || !onStop}
              aria-label="暂停生成"
              title="暂停生成"
              className="min-h-[34px] shrink-0 px-1.5 font-mono text-[15px] leading-none text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-err)] disabled:cursor-not-allowed disabled:text-[var(--color-ink-faint)]"
            >
              ⏸
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
