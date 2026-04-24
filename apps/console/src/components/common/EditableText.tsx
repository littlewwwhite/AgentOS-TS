// input: value (string), onChange callback, optional status/className/ariaLabel
// output: inline contenteditable element with placeholder, hover/focus underline hints
// pos: shared UI primitive used by script/storyboard editing views

import { useRef, useEffect, useCallback, KeyboardEvent, ClipboardEvent } from "react";

export interface EditableTextProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** default false — Enter submits; true — Enter inserts newline */
  multiline?: boolean;
  /** owner passes in derived from save state */
  status?: "idle" | "saving" | "saved" | "error";
  className?: string;
  ariaLabel?: string;
  readOnly?: boolean;
}

// Shared editable class list
const editableClass = [
  "outline-none cursor-text",
  "min-h-[20px] leading-5",
  "relative z-10",
  // Hover hint: dashed underline
  "hover:underline hover:decoration-dashed",
  // Focus: solid underline (overrides hover)
  "focus:underline focus:decoration-solid",
  // Keyboard focus ring
  "focus-visible:ring-2 focus-visible:ring-offset-2",
].join(" ");

const editableStyle: React.CSSProperties = {
  // Ring color set via CSS variable; textDecorationColor uses --color-rule
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ["--tw-ring-color" as any]: "var(--color-accent)",
  textDecorationColor: "var(--color-rule)",
};

export function EditableText({
  value,
  onChange,
  placeholder = "",
  multiline = false,
  status: _status,
  className = "",
  ariaLabel,
  readOnly = false,
}: EditableTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const divRef = useRef<HTMLDivElement>(null);

  // Typed helper to get the active element regardless of branch
  const getEl = useCallback(
    (): HTMLElement | null => (multiline ? divRef.current : spanRef.current),
    [multiline],
  );

  // Track last committed value to avoid spurious onChange on blur
  const committedRef = useRef<string>(value);
  // Track whether element is currently focused (prevents caret-jump reset)
  const focusedRef = useRef<boolean>(false);

  // Sync innerText from props only when NOT focused — prevents caret jump mid-typing
  useEffect(() => {
    const el = getEl();
    if (!el || focusedRef.current) return;
    if (el.innerText !== value) {
      el.innerText = value;
    }
    committedRef.current = value;
  }, [value, getEl]);

  const commit = useCallback(
    (el: HTMLElement) => {
      const next = el.innerText;
      if (next !== committedRef.current) {
        committedRef.current = next;
        onChange(next);
      }
    },
    [onChange],
  );

  const revert = useCallback((el: HTMLElement) => {
    el.innerText = committedRef.current;
  }, []);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);

  const handleBlur = useCallback(() => {
    focusedRef.current = false;
    const el = getEl();
    if (el) commit(el);
  }, [commit, getEl]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const el = getEl();
      if (!el) return;

      if (e.key === "Escape") {
        e.preventDefault();
        revert(el);
        el.blur();
        return;
      }

      if (e.key === "Enter") {
        const isCmdOrCtrl = e.metaKey || e.ctrlKey;
        if (multiline) {
          // Cmd/Ctrl+Enter commits in multiline mode; plain Enter inserts newline
          if (isCmdOrCtrl) {
            e.preventDefault();
            commit(el);
            el.blur();
          }
        } else {
          // Single-line: plain Enter (no Shift) commits
          if (!e.shiftKey) {
            e.preventDefault();
            commit(el);
            el.blur();
          }
        }
      }
    },
    [multiline, commit, revert, getEl],
  );

  // Sanitize paste to plain text; execCommand is deprecated but still the
  // correct approach for plain-text insertion that preserves undo history
  const handlePaste = useCallback((e: ClipboardEvent<HTMLElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  }, []);

  const isEmpty = value.length === 0;
  const singleLinePlaceholderWidth =
    !multiline && isEmpty && placeholder
      ? `${Math.max(Array.from(placeholder).length, 2)}em`
      : undefined;

  const sharedProps = {
    contentEditable: !readOnly,
    suppressContentEditableWarning: true,
    role: "textbox" as const,
    "aria-multiline": multiline,
    "aria-label": ariaLabel,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    className: `${editableClass}${readOnly ? " cursor-default hover:no-underline focus:no-underline opacity-80" : ""}`,
    style: readOnly ? { ...editableStyle, textDecoration: "none" } : editableStyle,
  };

  return (
    <span
      className={["relative inline-block min-h-[20px]", className]
        .filter(Boolean)
        .join(" ")}
      style={singleLinePlaceholderWidth ? { minWidth: singleLinePlaceholderWidth } : undefined}
    >
      {/* Placeholder ghost — pointer-events:none, hidden when non-empty */}
      {placeholder && (
        <span
          aria-hidden="true"
          className={[
            "pointer-events-none absolute inset-0",
            "italic select-none transition-opacity duration-150",
            multiline ? "whitespace-pre-wrap" : "whitespace-nowrap",
            isEmpty ? "opacity-100" : "opacity-0",
          ].join(" ")}
          style={{ color: "var(--color-ink-faint)" }}
        >
          {placeholder}
        </span>
      )}

      {/* Two explicit branches so TypeScript can resolve each ref type precisely */}
      {multiline ? (
        <div ref={divRef} {...sharedProps} />
      ) : (
        <span ref={spanRef} {...sharedProps} />
      )}
    </span>
  );
}
