// input: storyboard prompt string + ref dict + per-kind catalog of swap candidates
// output: inline rendering with name chips that swap underlying @-token on click
// pos: storyboard prompt editor — read mode default, raw textarea on toggle

import { useEffect, useMemo, useRef, useState } from "react";
import { tokenizePrompt, replacePromptRef } from "../../../lib/fountain";
import type { PromptRefKind, PromptSegment } from "../../../lib/fountain";

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
  dict: Record<string, string>;
  catalog: PromptCatalog;
  readOnly: boolean;
  ariaLabel: string;
  placeholder?: string;
  onChange: (next: string) => void;
}

export function PromptChipEditor({
  value,
  dict,
  catalog,
  readOnly,
  ariaLabel,
  placeholder,
  onChange,
}: Props) {
  const segments = useMemo(() => tokenizePrompt(value, dict), [value, dict]);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3 text-[11px]">
        <button
          type="button"
          className="font-mono uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
          onClick={() => setShowRaw((prev) => !prev)}
        >
          {showRaw ? "切回名称视图" : "查看原文"}
        </button>
      </div>
      {showRaw ? (
        <textarea
          aria-label={ariaLabel}
          className="block min-h-[260px] w-full resize-y border border-[var(--color-rule)] bg-[var(--color-paper-soft)] p-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-70"
          readOnly={readOnly}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <ChipRender
          ariaLabel={ariaLabel}
          segments={segments}
          catalog={catalog}
          readOnly={readOnly}
          placeholder={placeholder}
          onSwap={(segment, newId) => onChange(replacePromptRef(value, segment, newId))}
        />
      )}
    </div>
  );
}

function ChipRender({
  ariaLabel,
  segments,
  catalog,
  readOnly,
  placeholder,
  onSwap,
}: {
  ariaLabel: string;
  segments: PromptSegment[];
  catalog: PromptCatalog;
  readOnly: boolean;
  placeholder?: string;
  onSwap: (segment: Extract<PromptSegment, { kind: "ref" }>, newId: string) => void;
}) {
  if (segments.length === 0) {
    return (
      <div
        aria-label={ariaLabel}
        className="block min-h-[260px] w-full whitespace-pre-wrap border border-[var(--color-rule)] bg-[var(--color-paper-soft)] p-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink-faint)] italic"
      >
        {placeholder ?? "（空）"}
      </div>
    );
  }

  return (
    <div
      aria-label={ariaLabel}
      className="block min-h-[260px] w-full whitespace-pre-wrap border border-[var(--color-rule)] bg-[var(--color-paper-soft)] p-3 font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)]"
    >
      {segments.map((segment, idx) =>
        segment.kind === "text" ? (
          <span key={idx}>{segment.value}</span>
        ) : (
          <RefChip
            key={idx}
            segment={segment}
            options={catalog[segment.refKind]}
            readOnly={readOnly}
            onSwap={(newId) => onSwap(segment, newId)}
          />
        ),
      )}
    </div>
  );
}

const REF_KIND_STYLES: Record<PromptRefKind, string> = {
  actor:
    "border-b border-[var(--color-accent)]/60 bg-[var(--color-accent)]/8 text-[var(--color-ink)]",
  location:
    "border-b border-[#7a8e6a]/70 bg-[#7a8e6a]/10 text-[var(--color-ink)]",
  prop:
    "border-b border-[#a07a55]/70 bg-[#a07a55]/10 text-[var(--color-ink)]",
};

const REF_KIND_LABEL: Record<PromptRefKind, string> = {
  actor: "角色",
  location: "场景",
  prop: "道具",
};

function RefChip({
  segment,
  options,
  readOnly,
  onSwap,
}: {
  segment: Extract<PromptSegment, { kind: "ref" }>;
  options: PromptCatalogEntry[];
  readOnly: boolean;
  onSwap: (newId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleAway(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleAway);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleAway);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  const styleClass = REF_KIND_STYLES[segment.refKind];
  const label = REF_KIND_LABEL[segment.refKind];
  const hasOptions = options.length > 0;

  return (
    <span ref={containerRef} className="relative inline-block">
      <button
        type="button"
        title={`${label} · ${segment.id}${segment.stateId ? `:${segment.stateId}` : ""}`}
        disabled={readOnly || !hasOptions}
        className={
          "px-1 py-0 align-baseline transition-colors rounded-[1px] " +
          styleClass +
          (readOnly || !hasOptions
            ? " cursor-default"
            : " cursor-pointer hover:bg-[var(--color-accent)]/15")
        }
        onClick={() => {
          if (readOnly || !hasOptions) return;
          setOpen((prev) => !prev);
        }}
      >
        {segment.name}
      </button>
      {open && (
        <span
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-[260px] min-w-[160px] overflow-y-auto border border-[var(--color-rule)] bg-[var(--color-paper)] shadow-md"
        >
          <span className="block border-b border-[var(--color-rule)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
            替换{label}
          </span>
          {options.map((option) => {
            const isSelected = option.id === segment.id;
            return (
              <button
                type="button"
                key={option.id}
                role="option"
                aria-selected={isSelected}
                className={
                  "block w-full px-3 py-1.5 text-left text-[13px] transition-colors " +
                  (isSelected
                    ? "bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)]")
                }
                onClick={() => {
                  setOpen(false);
                  if (option.id !== segment.id) onSwap(option.id);
                }}
              >
                <span>{option.name}</span>
                <span className="ml-2 font-mono text-[10px] text-[var(--color-ink-faint)]">
                  {option.id}
                </span>
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
