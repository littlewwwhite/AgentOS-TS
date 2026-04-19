import { useMemo } from "react";
import { useFileText } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

interface Token { text: string; kind: "key" | "string" | "number" | "bool" | "null" | "punct" | "ws" }

function tokenize(pretty: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = pretty.length;
  while (i < len) {
    const c = pretty[i];
    if (c === '"') {
      const start = i;
      i++;
      while (i < len && pretty[i] !== '"') {
        if (pretty[i] === '\\') i++;
        i++;
      }
      i++;
      const text = pretty.slice(start, i);
      let j = i;
      while (j < len && pretty[j] !== '\n' && pretty[j].match(/\s/)) j++;
      const isKey = pretty[j] === ':';
      tokens.push({ text, kind: isKey ? "key" : "string" });
      continue;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const start = i;
      while (i < len && /[-0-9.eE+]/.test(pretty[i])) i++;
      tokens.push({ text: pretty.slice(start, i), kind: "number" });
      continue;
    }
    if (pretty.startsWith("true", i) || pretty.startsWith("false", i)) {
      const word = pretty.startsWith("true", i) ? "true" : "false";
      tokens.push({ text: word, kind: "bool" });
      i += word.length;
      continue;
    }
    if (pretty.startsWith("null", i)) {
      tokens.push({ text: "null", kind: "null" });
      i += 4;
      continue;
    }
    if (/\s/.test(c)) {
      const start = i;
      while (i < len && /\s/.test(pretty[i])) i++;
      tokens.push({ text: pretty.slice(start, i), kind: "ws" });
      continue;
    }
    tokens.push({ text: c, kind: "punct" });
    i++;
  }
  return tokens;
}

function colorFor(kind: Token["kind"]): string | undefined {
  switch (kind) {
    case "key":    return "var(--color-accent)";
    case "string": return "var(--color-ink)";
    case "number": return "var(--color-run)";
    case "bool":   return "var(--color-warn)";
    case "null":   return "var(--color-ink-subtle)";
    case "punct":  return "var(--color-ink-muted)";
    default:       return undefined;
  }
}

export function JsonView({ projectName, path }: Props) {
  const { text, error } = useFileText(projectName, path);
  const pretty = useMemo(() => {
    if (!text) return "";
    try { return JSON.stringify(JSON.parse(text), null, 2); }
    catch { return text; }
  }, [text]);
  const tokens = useMemo(() => tokenize(pretty), [pretty]);
  const lineCount = pretty.split("\n").length;

  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">加载失败：{error}</div>;
  if (text == null) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">加载中…</div>;

  return (
    <div className="flex font-mono text-[12px] leading-[1.7]">
      <div aria-hidden className="shrink-0 pl-4 pr-3 py-6 text-right text-[var(--color-ink-faint)] select-none border-r border-[var(--color-rule)] bg-[var(--color-paper-soft)]">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="flex-1 px-6 py-6 whitespace-pre-wrap break-words">
        {tokens.map((t, i) => (
          <span key={i} style={t.kind === "null" ? { color: colorFor(t.kind), fontStyle: "italic" } : { color: colorFor(t.kind) }}>
            {t.text}
          </span>
        ))}
      </pre>
    </div>
  );
}
