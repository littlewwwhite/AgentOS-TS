import { useFileText } from "../../../hooks/useFile";

interface Props { projectName: string; path: string; }

export function TextView({ projectName, path }: Props) {
  const { text, error } = useFileText(projectName, path);
  if (error) return <div className="p-6 text-[13px] text-[var(--color-err)]">Load failed: {error}</div>;
  if (text == null) return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">Loading…</div>;
  return (
    <div className="px-10 py-10 bg-[var(--color-paper-sunk)] min-h-full">
      <pre className="max-w-[72ch] font-sans text-[15px] leading-[1.6] text-[var(--color-ink)] whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}
