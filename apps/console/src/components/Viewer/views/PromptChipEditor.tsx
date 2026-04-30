// input: storyboard prompt string + ref dict + per-kind catalog of swap candidates
// output: compact readable prompt block with leading PART\d+ marker stripped
// pos: storyboard prompt preview — review-first surface, no raw-ID drawer

import { useCallback, useEffect, type ReactNode } from "react";
import { assetKindFromId, type ProductionAssetKind } from "../../../lib/storyboard";

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
  selectedRefKey?: string | null;
  onSelectRef?: (ref: PromptRefSelection) => void;
  onClearSelectedRef?: () => void;
}

const PART_PREFIX = /^PART\d+\s*\n+/;
const REF_PATTERN = /(@|\{)((?:act|loc|prp|prop)_\d+)(?::(st_\d+))?\}?/gi;

export interface PromptRefSelection {
  raw: string;
  id: string;
  stateId?: string;
  index?: number;
  occurrenceKey?: string;
}

type PromptAssetKind = ProductionAssetKind;

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

function collectEditablePrompt(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  const rawRef = node.dataset.rawRef;
  if (rawRef) return rawRef;
  if (node.tagName === "BR") return "\n";
  const text = Array.from(node.childNodes).map(collectEditablePrompt).join("");
  return node.tagName === "DIV" || node.tagName === "P" ? `${text}\n` : text;
}

export function replacePromptRef(
  prompt: string,
  selection: PromptRefSelection | null | undefined,
  nextId: string,
): string {
  if (!selection) {
    return `${prompt.trimEnd()}\n@${nextId}`;
  }
  const selectedIndex = typeof selection.index === "number" ? selection.index : -1;
  const index = selectedIndex >= 0 && prompt.slice(selectedIndex, selectedIndex + selection.raw.length) === selection.raw
    ? selectedIndex
    : prompt.indexOf(selection.raw);
  if (index < 0) return `${prompt.trimEnd()}\n@${nextId}`;
  return `${prompt.slice(0, index)}@${nextId}${prompt.slice(index + selection.raw.length)}`;
}

export function PromptRefText({
  text,
  dict = {},
  catalog,
  actorStateOverrides,
  stateNameById = {},
  selectedRefKey,
  refIndexOffset = 0,
  onSelectRef,
  onReplaceRef,
}: {
  text: string;
  dict?: Record<string, string>;
  catalog?: PromptCatalog;
  actorStateOverrides?: Map<string, string>;
  stateNameById?: Record<string, string>;
  selectedRefKey?: string | null;
  refIndexOffset?: number;
  onSelectRef?: (ref: PromptRefSelection) => void;
  onReplaceRef?: (selection: PromptRefSelection, nextId: string) => void;
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
    const absoluteIndex = refIndexOffset + match.index;
    const occurrenceKey = `${absoluteIndex}:${raw}`;
    const selected = selectedRefKey === occurrenceKey;
    const selection = { raw, id, stateId: match[3], index: absoluteIndex, occurrenceKey };
    const kind = assetKindFromId(id);
    const replacementOptions = kind && catalog && onReplaceRef
      ? catalog[kind].filter((entry) => entry.id !== id)
      : [];
    const className =
      "inline-flex align-baseline border px-1 py-0.5 font-[Geist,sans-serif] text-[12px] leading-none " +
      refToneClassName(id, selected);

    nodes.push(
      onSelectRef ? (
        <span
          key={`${match.index}-${raw}`}
          data-raw-ref={raw}
          data-prompt-ref-interactive="true"
          contentEditable={false}
          className="relative inline-flex align-baseline"
        >
          <button
            type="button"
            className={`${className} cursor-pointer`}
            onClick={() => onSelectRef(selection)}
          >
            {label}
          </button>
          {selected && replacementOptions.length > 0 && (
            <span
              role="menu"
              aria-label={`替换 ${label}`}
              className="absolute left-0 top-[calc(100%+4px)] z-30 grid min-w-[148px] border border-[var(--color-ink)] bg-[var(--color-paper)] py-1 shadow-[0_14px_34px_rgba(0,0,0,0.14)]"
            >
              {replacementOptions.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="menuitem"
                  aria-label={`替换为 ${entry.name}`}
                  className="block w-full px-3 py-1.5 text-left font-[Geist,sans-serif] text-[12px] text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)] focus:outline-none focus-visible:bg-[var(--color-paper-soft)]"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onReplaceRef(selection, entry.id)}
                >
                  <span className="sr-only">替换为 </span>
                  {entry.name}
                </button>
              ))}
            </span>
          )}
        </span>
      ) : (
        <span
          key={`${match.index}-${raw}`}
          data-raw-ref={raw}
          contentEditable={false}
          className={className}
        >
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
  catalog,
  actorStateOverrides,
  stateNameById = {},
  ariaLabel,
  placeholder,
  onChange,
  readOnly,
  selectedRefKey,
  onSelectRef,
  onClearSelectedRef,
}: Props) {
  const { prefix, body: display } = splitPartPrefix(value);
  const handleReplaceRef = useCallback(
    (selection: PromptRefSelection, nextId: string) => {
      onChange(replacePromptRef(value, selection, nextId));
      onSelectRef?.({
        raw: `@${nextId}`,
        id: nextId,
        index: selection.index,
        occurrenceKey: typeof selection.index === "number" ? `${selection.index}:@${nextId}` : undefined,
      });
    },
    [onChange, onSelectRef, value],
  );
  const handleEditableBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const next = collectEditablePrompt(event.currentTarget).replace(/\n$/, "");
      onChange(`${prefix}${next}`);
    },
    [onChange, prefix],
  );
  useEffect(() => {
    if (!selectedRefKey || !onClearSelectedRef) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-prompt-ref-interactive='true']")) return;
      onClearSelectedRef();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClearSelectedRef, selectedRefKey]);

  return (
    <div
      aria-label={ariaLabel}
      role={readOnly ? undefined : "textbox"}
      tabIndex={readOnly ? undefined : 0}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onBlur={readOnly ? undefined : handleEditableBlur}
      onKeyDown={readOnly ? undefined : (event) => {
        if (event.key === "Escape" && selectedRefKey) {
          event.preventDefault();
          onClearSelectedRef?.();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      className={
        "h-full min-h-[260px] overflow-y-auto border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-3 py-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap " +
        (readOnly ? "" : "cursor-text transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:border-[var(--color-accent)]")
      }
    >
      {display ? (
        <PromptRefText
          text={display}
          dict={dict}
          catalog={catalog}
          actorStateOverrides={actorStateOverrides}
          stateNameById={stateNameById}
          selectedRefKey={selectedRefKey}
          refIndexOffset={prefix.length}
          onSelectRef={onSelectRef}
          onReplaceRef={readOnly ? undefined : handleReplaceRef}
        />
      ) : (
        <span className="text-[var(--color-ink-faint)]">{placeholder}</span>
      )}
    </div>
  );
}
