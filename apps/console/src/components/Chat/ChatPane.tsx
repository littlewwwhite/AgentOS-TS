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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !isConnected) return;
    onSend(input);
    setInput("");
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
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

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
        {/* Thinking spinner: show only when streaming but no text bubble is actively streaming */}
        {isStreaming && (() => {
          const lastMsg = messages[messages.length - 1];
          const hasActiveAssistantStream =
            lastMsg &&
            lastMsg.role === "assistant" &&
            !lastMsg.toolName &&
            lastMsg.isStreaming === true;
          if (hasActiveAssistantStream) return null;
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
        className="relative border-t border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-5 py-4"
      >
        {commandOptions.length > 0 && (
          <div className="absolute bottom-full left-5 right-5 mb-2 max-h-64 overflow-auto bg-[var(--color-paper)] py-1 shadow-[0_12px_36px_rgba(0,0,0,0.08)] ring-1 ring-[var(--color-rule)]">
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
        <div className="border border-[var(--color-rule)] bg-[var(--color-paper)] px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.03)]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="font-sans text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
              导演指令
            </div>
            <div className="font-sans text-[10px] text-[var(--color-ink-faint)]">
              输入 / 调用制作技能
            </div>
          </div>
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={isConnected ? "描述你要调整的镜头、分镜、素材或下一步制作任务…" : "连接中…"}
              disabled={!isConnected}
              rows={2}
              className="min-h-[54px] flex-1 resize-none border-0 bg-transparent px-0 py-0 text-[13px] leading-relaxed text-[var(--color-ink)] outline-none placeholder-[var(--color-ink-faint)] disabled:opacity-40"
            />
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="submit"
                disabled={!input.trim() || !isConnected}
                className="bg-[var(--color-ink)] px-4 py-2 font-sans text-[11px] font-semibold text-[var(--color-paper)] transition-colors hover:bg-[var(--color-accent)] disabled:bg-transparent disabled:text-[var(--color-ink-faint)] disabled:cursor-not-allowed"
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
                  className="font-mono text-[16px] leading-none text-[var(--color-ink-muted)] hover:text-[var(--color-err)] px-1.5 py-2 disabled:text-[var(--color-ink-faint)] disabled:cursor-not-allowed transition-colors"
                >
                  ⏸
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
