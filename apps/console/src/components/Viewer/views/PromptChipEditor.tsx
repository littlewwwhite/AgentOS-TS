// input: storyboard prompt string + ref dict + per-kind catalog of swap candidates
// output: always-editable textarea with leading PART\d+ marker stripped
// pos: storyboard prompt editor — direct edit, no chip view, no toggle

export interface PromptCatalogEntry {
  id: string;
  name: string;
}

export interface PromptCatalog {
  actor: PromptCatalogEntry[];
  location: PromptCatalogEntry[];
  prop: PromptCatalogEntry[];
}

interface Props {
  value: string;
  // Kept for API compatibility with existing callers; chip view was removed.
  dict?: Record<string, string>;
  catalog?: PromptCatalog;
  readOnly: boolean;
  ariaLabel: string;
  placeholder?: string;
  onChange: (next: string) => void;
  actorStateOverrides?: Map<string, string>;
  stateNameById?: Record<string, string>;
}

const PART_PREFIX = /^PART\d+\s*\n+/;

function stripPartPrefix(text: string): string {
  return text.replace(PART_PREFIX, "");
}

export function PromptChipEditor({
  value,
  readOnly,
  ariaLabel,
  placeholder,
  onChange,
}: Props) {
  const display = stripPartPrefix(value);

  return (
    <textarea
      aria-label={ariaLabel}
      className="block min-h-[260px] w-full resize-y border border-[var(--color-rule)] bg-[var(--color-paper-soft)] p-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-70"
      readOnly={readOnly}
      value={display}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
