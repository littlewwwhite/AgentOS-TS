// input: projectName + relPath + content kind
// output: guarded raw text editor for editable artifacts
// pos: fallback editor for files without a domain-specific rendered editor

import { useCallback, useEffect, useMemo, useState } from "react";
import { useProject } from "../../contexts/ProjectContext";
import { fileUrl } from "../../lib/fileUrl";
import { resolveProductionObjectFromPath } from "../../lib/productionObject";
import { getEditImpactUiLabel, getProductionObjectUiTitle } from "../../lib/productionObjectUi";
import { ArtifactLifecycleActions } from "./ArtifactLifecycleActions";

interface Props {
  projectName: string;
  path: string;
  contentKind: "json" | "text";
  onSaved?: () => void;
}

type SaveState = "loading" | "idle" | "saving" | "saved" | "error";

function savedAtLabel(savedAt: number | null): string {
  if (savedAt === null) return "";
  const d = new Date(savedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return ` ${hh}:${mm}`;
}

function helperLabel(
  state: SaveState,
  savedAt: number | null,
  error: string | null,
  dirty: boolean,
): string {
  if (state === "saving") return "保存中…";
  if (state === "saved") return `已保存${savedAtLabel(savedAt)}`;
  if (state === "error") return `保存失败：${error ?? "未知错误"}`;
  if (dirty) return "有未保存修改";
  return "未修改";
}

export function RawFileEditor({ projectName, path, contentKind, onSaved }: Props) {
  const { state: projectState } = useProject();
  const [serverText, setServerText] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("loading");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setError(null);
    setServerText(null);
    setDraftText("");

    fetch(fileUrl(projectName, path))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (cancelled) return;
        setServerText(text);
        setDraftText(text);
        setState("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err instanceof Error ? err.message : err));
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [path, projectName]);

  const object = useMemo(() => resolveProductionObjectFromPath(path), [path]);
  const objectLabel = getProductionObjectUiTitle(object);
  const dirty = serverText !== null && draftText !== serverText;
  const impact = useMemo(() => getEditImpactUiLabel(path), [path]);
  const locked = projectState?.artifacts?.[path]?.status === "locked" || projectState?.artifacts?.[path]?.editable === false;

  const handleSave = useCallback(async () => {
    setState("saving");
    setError(null);
    try {
      const response = await fetch(
        `/api/file?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(path)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": contentKind === "json" ? "application/json" : "text/plain; charset=utf-8",
          },
          body: draftText,
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }

      setServerText(draftText);
      setSavedAt(Date.now());
      setState("saved");
      onSaved?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setState("error");
    }
  }, [contentKind, draftText, onSaved, path, projectName]);

  if (state === "error" && serverText === null) {
    return <div className="p-6 text-[13px] text-[var(--color-err)]">加载失败：{error}</div>;
  }

  if (serverText === null) {
    return <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">加载中…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-6 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 truncate font-serif text-[24px] leading-tight text-[var(--color-ink)]">
            {objectLabel}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {impact && (
              <span className="font-[Geist,sans-serif] text-[11px] text-[var(--color-ink-subtle)]">
                {impact}
              </span>
            )}
            <span className="font-[Geist,sans-serif] text-[11px] text-[var(--color-ink-muted)]">
              {helperLabel(state, savedAt, error, dirty)}
            </span>
            <ArtifactLifecycleActions projectName={projectName} path={path} onActionDone={onSaved} />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={locked || !dirty || state === "saving"}
              className="border border-[var(--color-rule)] px-3 py-1 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:text-[var(--color-ink-faint)]"
            >
              保存
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-[var(--color-paper-sunk)] px-8 py-8">
        <textarea
          value={draftText}
          onChange={(event) => {
            setDraftText(event.target.value);
            if (state === "saved" || state === "error") setState("idle");
          }}
          disabled={locked}
          spellCheck={false}
          className="h-full min-h-[420px] w-full resize-none border border-[var(--color-rule)] bg-[var(--color-paper)] p-4 font-mono text-[13px] leading-[1.7] text-[var(--color-ink)] outline-none disabled:cursor-not-allowed disabled:bg-[var(--color-paper-soft)] disabled:text-[var(--color-ink-muted)]"
          aria-label={`${objectLabel} 编辑区`}
        />
      </div>
    </div>
  );
}
