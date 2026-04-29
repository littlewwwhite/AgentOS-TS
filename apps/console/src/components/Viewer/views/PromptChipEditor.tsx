// input: storyboard prompt string + ref dict + per-kind catalog of swap candidates
// output: compact readable prompt block with leading PART\d+ marker stripped
// pos: storyboard prompt preview — review-first surface, no raw-ID drawer

import type { ReactNode } from "react";

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
  editing?: boolean;
  actorStateOverrides?: Map<string, string>;
  stateNameById?: Record<string, string>;
  selectedRefId?: string | null;
  onSelectRef?: (ref: PromptRefSelection) => void;
}

const PART_PREFIX = /^PART\d+\s*\n+/;
const REF_PATTERN = /(@|\{)((?:act|loc|prp|prop)_\d+)(?::(st_\d+))?\}?/gi;

export interface PromptRefSelection {
  raw: string;
  id: string;
  stateId?: string;
}

function splitPartPrefix(text: string): { prefix: string; body: string } {
  const match = text.match(PART_PREFIX);
  const prefix = match?.[0] ?? "";
  return { prefix, body: text.slice(prefix.length) };
}

function readableRefLabel(
  id: string,
  stateId: string | undefined,
  dict: Record<string, string>,
  actorStateOverrides?: Map<string, string>,
  stateNameById: Record<string, string> = {},
): string | null {
  const normalized = id.toLowerCase();
  const resolvedStateId = stateId ?? actorStateOverrides?.get(normalized);
  const name = dict[normalized];
  if (!name) return null;
  const stateName = resolvedStateId ? stateNameById[resolvedStateId] : undefined;
  return stateName ? `${name}（${stateName}）` : name;
}

function refToneClassName(id: string, selected: boolean): string {
  if (id.startsWith("act_")) {
    return selected
      ? "border-[#8aa800] bg-[#dfff2f] text-[#172200]"
      : "border-[#b7d900] bg-[#e7ff5f] text-[#1d2c00]";
  }
  if (id.startsWith("loc_")) {
    return selected
      ? "border-[#009db0] bg-[#5eefff] text-[#002b31]"
      : "border-[#39cfe0] bg-[#8ff7ff] text-[#003940]";
  }
  if (id.startsWith("prp_") || id.startsWith("prop_")) {
    return selected
      ? "border-[#d85ca4] bg-[#ffafe1] text-[#3f0027]"
      : "border-[#f58acb] bg-[#ffd1f0] text-[#4b0030]";
  }
  return selected
    ? "border-[var(--color-accent)] bg-[var(--color-paper)] text-[var(--color-ink)]"
    : "border-[var(--color-rule)] bg-[var(--color-paper)] text-[var(--color-ink)]";
}

export function replacePromptRef(
  prompt: string,
  selection: PromptRefSelection | null | undefined,
  nextId: string,
): string {
  if (!selection) {
    return `${prompt.trimEnd()}\n@${nextId}`;
  }
  const index = prompt.indexOf(selection.raw);
  if (index < 0) return `${prompt.trimEnd()}\n@${nextId}`;
  return `${prompt.slice(0, index)}@${nextId}${prompt.slice(index + selection.raw.length)}`;
}

export function PromptRefText({
  text,
  dict = {},
  actorStateOverrides,
  stateNameById = {},
  selectedRefId,
  onSelectRef,
}: {
  text: string;
  dict?: Record<string, string>;
  actorStateOverrides?: Map<string, string>;
  stateNameById?: Record<string, string>;
  selectedRefId?: string | null;
  onSelectRef?: (ref: PromptRefSelection) => void;
}) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(REF_PATTERN)) {
    const raw = match[0];
    const id = match[2]?.toLowerCase();
    if (!raw || !id || match.index === undefined) continue;

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const label = readableRefLabel(id, match[3], dict, actorStateOverrides, stateNameById) ?? raw;
    const selected = selectedRefId === id;
    const className =
      "inline-flex align-baseline border px-1 py-0.5 font-[Geist,sans-serif] text-[12px] leading-none " +
      refToneClassName(id, selected);

    nodes.push(
      onSelectRef ? (
        <button
          key={`${match.index}-${raw}`}
          type="button"
          className={`${className} cursor-pointer`}
          onClick={() => onSelectRef({ raw, id, stateId: match[3] })}
        >
          {label}
        </button>
      ) : (
        <span key={`${match.index}-${raw}`} className={className}>
          {label}
        </span>
      ),
    );
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes.length > 0 ? nodes : text}</>;
}

export function PromptChipEditor({
  value,
  dict = {},
  actorStateOverrides,
  stateNameById = {},
  ariaLabel,
  placeholder,
  onChange,
  readOnly,
  editing = false,
  selectedRefId,
  onSelectRef,
}: Props) {
  const { prefix, body: display } = splitPartPrefix(value);

  if (editing && !readOnly) {
    return (
      <textarea
        aria-label={`${ariaLabel} 编辑`}
        value={display}
        placeholder={placeholder}
        onChange={(event) => onChange(`${prefix}${event.currentTarget.value}`)}
        className="h-full min-h-[260px] w-full resize-none overflow-y-auto border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-3 py-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
      />
    );
  }

  return (
    <div
      aria-label={ariaLabel}
      className="h-full min-h-[260px] overflow-y-auto border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-3 py-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap"
    >
      {display ? (
        <PromptRefText
          text={display}
          dict={dict}
          actorStateOverrides={actorStateOverrides}
          stateNameById={stateNameById}
          selectedRefId={selectedRefId}
          onSelectRef={onSelectRef}
        />
      ) : (
        <span className="text-[var(--color-ink-faint)]">{placeholder}</span>
      )}
    </div>
  );
}
