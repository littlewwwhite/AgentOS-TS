import { useMemo, useState } from "react";
import { useProject } from "../../contexts/ProjectContext";
import { getEditPolicy } from "../../lib/editPolicy";
import type { ArtifactAction } from "../../lib/artifactActions";
import type { StageStatus } from "../../types";

interface Props {
  projectName: string;
  path: string;
  onActionDone?: () => void;
}

function canApprove(status?: StageStatus): boolean {
  return status !== "approved" && status !== "locked";
}

function canLock(status?: StageStatus): boolean {
  return status !== "locked";
}

function canUnlock(status?: StageStatus): boolean {
  return status === "locked";
}

function canRequestChange(status?: StageStatus): boolean {
  return status !== "change_requested";
}

export function ArtifactLifecycleActions({ projectName, path, onActionDone }: Props) {
  const { state, refresh } = useProject();
  const [busy, setBusy] = useState<ArtifactAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const policy = useMemo(() => getEditPolicy(path), [path]);
  const artifact = state?.artifacts?.[path];
  const status = artifact?.status ?? state?.stages?.[policy?.stage ?? ""]?.status;

  if (!policy || policy.artifactKind !== "canonical") return null;

  async function trigger(action: ArtifactAction) {
    let reason: string | undefined;
    if (action === "request_change") {
      const next = window.prompt("请输入返修原因");
      if (!next || !next.trim()) return;
      reason = next.trim();
    }

    setBusy(action);
    setError(null);
    try {
      const response = await fetch(
        `/api/artifact-action?project=${encodeURIComponent(projectName)}&path=${encodeURIComponent(path)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }
      refresh();
      onActionDone?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canApprove(status) && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void trigger("approve")}
          className="border border-[var(--color-rule)] px-3 py-1 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:text-[var(--color-ink-faint)]"
        >
          {busy === "approve" ? "通过中…" : "通过"}
        </button>
      )}
      {canLock(status) && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void trigger("lock")}
          className="border border-[var(--color-rule)] px-3 py-1 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:text-[var(--color-ink-faint)]"
        >
          {busy === "lock" ? "锁版中…" : "锁版"}
        </button>
      )}
      {canUnlock(status) && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void trigger("unlock")}
          className="border border-[var(--color-rule)] px-3 py-1 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:text-[var(--color-ink-faint)]"
        >
          {busy === "unlock" ? "解锁中…" : "解锁"}
        </button>
      )}
      {canRequestChange(status) && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void trigger("request_change")}
          className="border border-[var(--color-rule)] px-3 py-1 font-[Geist,sans-serif] text-[11px] font-semibold text-[var(--color-ink)] disabled:cursor-not-allowed disabled:text-[var(--color-ink-faint)]"
        >
          {busy === "request_change" ? "提交中…" : "返修"}
        </button>
      )}
      {error && (
        <span className="font-[Geist,sans-serif] text-[11px] text-[var(--color-err)]">
          {error}
        </span>
      )}
    </div>
  );
}
