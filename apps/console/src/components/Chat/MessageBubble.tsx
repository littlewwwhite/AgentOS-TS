import type { ReactNode } from "react";
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

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${nodes.length}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold text-[var(--color-ink)]">{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={key} className="bg-[var(--color-paper-sunk)] px-1 py-0.5 font-mono text-[11px] text-[var(--color-ink)]">{token.slice(1, -1)}</code>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`code-${blocks.length}`} className="overflow-x-auto bg-[var(--color-paper-sunk)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const className = "font-[Geist,sans-serif] font-semibold leading-snug text-[var(--color-ink)]";
      const children = renderInlineMarkdown(heading[2], `h-${blocks.length}`);
      if (level === 1) blocks.push(<h1 key={`h-${blocks.length}`} className={`${className} text-[15px]`}>{children}</h1>);
      else if (level === 2) blocks.push(<h2 key={`h-${blocks.length}`} className={`${className} text-[14px]`}>{children}</h2>);
      else blocks.push(<h3 key={`h-${blocks.length}`} className={`${className} text-[13px]`}>{children}</h3>);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-4">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item, `li-${blocks.length}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="list-decimal space-y-1 pl-4">
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item, `oli-${blocks.length}-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push(
      <p key={`p-${blocks.length}`}>
        {renderInlineMarkdown(paragraphLines.join(" "), `p-${blocks.length}`)}
      </p>,
    );
  }

  return <div className="space-y-2 break-words">{blocks}</div>;
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
      <div className={`max-w-[52ch] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink)] break-words ${isUser ? "whitespace-pre-wrap bg-[var(--color-chat-user)] text-right" : "bg-[var(--color-chat-assistant)]"}`}>
        {isUser ? content : <MarkdownMessage content={content} />}
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
