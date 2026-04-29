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
  dict = {},
  actorStateOverrides,
  stateNameById = {},
  readOnly,
  ariaLabel,
  placeholder,
  onChange,
}: Props) {
  const display = stripPartPrefix(value);
  const readableDisplay = display.replace(
    /@((?:act|loc|prp|prop)_\d+)(?::(st_\d+))?/gi,
    (token, rawId: string, rawStateId?: string) => {
      const id = rawId.toLowerCase();
      const stateId = rawStateId ?? actorStateOverrides?.get(id);
      const name = dict[id];
      if (!name) return token;
      const stateName = stateId ? stateNameById[stateId] : undefined;
      return stateName ? `${name}（${stateName}）` : name;
    },
  );

  return (
    <div className="grid h-full min-h-[260px] grid-rows-[minmax(0,1fr)_auto] gap-2">
      <div className="min-h-0 overflow-y-auto border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-3 py-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">
        {readableDisplay || (
          <span className="text-[var(--color-ink-faint)]">{placeholder}</span>
        )}
      </div>
      <details className="border border-[var(--color-rule)] bg-[var(--color-paper)]">
        <summary className="cursor-pointer select-none px-3 py-2 font-[Geist,sans-serif] text-[11px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
          原始 prompt
        </summary>
        <textarea
          aria-label={ariaLabel}
          className="block min-h-[150px] w-full resize-y border-0 border-t border-[var(--color-rule)] bg-[var(--color-paper-soft)] p-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-70"
          readOnly={readOnly}
          value={display}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </details>
    </div>
  );
}
