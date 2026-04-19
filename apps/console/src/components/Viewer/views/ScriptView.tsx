// input: projectName + relPath → script.json via useEditableJson
// output: Fountain-format screenplay renderer with inline editing
// pos: ScriptView panel inside the Viewer; replaces old collapsible metadata list

import { useCallback } from "react";
import {
  buildRefDict,
  buildFountainTokens,
  type ScriptJson,
  type FountainToken,
} from "../../../lib/fountain";
import { useEditableJson, getAtPath } from "../../../hooks/useEditableJson";
import { EditableText } from "../../common/EditableText";
import { SaveStatusDot } from "../../common/SaveStatusDot";

// ---------------------------------------------------------------------------
// SaveStatusLabel — human-readable Chinese label next to the dot
// ---------------------------------------------------------------------------

function savedAtLabel(savedAt: number | null): string {
  if (savedAt === null) return "";
  const d = new Date(savedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return ` ${hh}:${mm}`;
}

function SaveStatusLabel({
  status,
  savedAt,
  error,
}: {
  status: "idle" | "loading" | "saving" | "saved" | "error";
  savedAt: number | null;
  error: string | null;
}) {
  const dotStatus: "idle" | "saving" | "saved" | "error" =
    status === "loading" ? "idle" : status === "idle" ? "idle" : status;

  let label: string;
  if (status === "saving") {
    label = "保存中…";
  } else if (status === "saved") {
    label = `已保存${savedAtLabel(savedAt)}`;
  } else if (status === "error") {
    label = `保存失败：${error ?? "未知错误"}`;
  } else {
    label = "未修改";
  }

  return (
    <span className="flex items-center gap-1.5">
      <SaveStatusDot status={dotStatus} />
      <span
        className="font-[Geist,sans-serif] text-[11px] text-[var(--color-ink-muted)]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// RefLegend — compact placeholder mapping panel
// ---------------------------------------------------------------------------

function RefLegend({ dict }: { dict: Record<string, string> }) {
  const entries = Object.entries(dict);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-[var(--color-ink-subtle)] mb-4">
      {entries.map(([id, name]) => (
        <span key={id}>
          <span className="text-[var(--color-ink-faint)]">{`{${id}}`}</span>
          <span className="ml-1">{name}</span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SceneHeading
// ---------------------------------------------------------------------------

function SceneHeading({
  sceneId,
  space,
  location,
  time,
}: {
  sceneId: string;
  space: string | null;
  location: string | null;
  time: string | null;
}) {
  const parts: string[] = [];
  const prefix: string[] = [];
  if (space) prefix.push(space);
  if (location) prefix.push(location);
  const prefixStr = prefix.join(". ");
  if (prefixStr) parts.push(prefixStr);
  if (time) parts.push(time);
  const heading = parts.join(" — ");

  return (
    <div className="mt-6 mb-2">
      <div className="font-mono text-[10px] text-[var(--color-ink-faint)] uppercase tracking-wider mb-0.5">
        {sceneId}
      </div>
      <div className="font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink)]">
        {heading || sceneId}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token renderers
// ---------------------------------------------------------------------------

type PatchFn = (path: string, value: unknown) => void;

function renderToken(
  token: FountainToken,
  data: ScriptJson,
  patch: PatchFn,
  status: "idle" | "loading" | "saving" | "saved" | "error",
): React.ReactNode {
  const editStatus: "idle" | "saving" | "saved" | "error" =
    status === "loading" ? "idle" : status;

  switch (token.kind) {
    case "title":
    case "meta":
      // Rendered separately outside the token loop
      return null;

    case "episode":
      // Rendered as article headers outside the token loop
      return null;

    case "scene_heading":
      return (
        <SceneHeading
          key={`${token.epIndex}-${token.sceneIndex}-heading`}
          sceneId={token.sceneId}
          space={token.space}
          location={token.location}
          time={token.time}
        />
      );

    case "action": {
      const raw = String(getAtPath(data, token.editablePath) ?? "");
      return (
        <div
          key={`${token.epIndex}-${token.sceneIndex}-${token.actionIndex}-action`}
          className="font-[Geist,sans-serif] text-[15px] leading-relaxed text-[var(--color-ink)] w-full"
        >
          <EditableText
            value={raw}
            onChange={(v) => patch(token.editablePath, v)}
            placeholder="（动作描述）"
            multiline
            status={editStatus}
            className="w-full block"
            ariaLabel="动作描述"
          />
        </div>
      );
    }

    case "character":
      return (
        <div
          key={`${token.epIndex}-${token.sceneIndex}-${token.actionIndex}-char`}
          className="font-serif italic text-[14px] uppercase tracking-wide text-[var(--color-ink)] ml-[20ch] mt-4"
        >
          {token.name}
        </div>
      );

    case "paren": {
      const raw = String(getAtPath(data, token.editablePath) ?? "");
      return (
        <div
          key={`${token.epIndex}-${token.sceneIndex}-${token.actionIndex}-paren`}
          className="font-serif italic text-[13px] text-[var(--color-ink-muted)] ml-[18ch]"
        >
          <span>（</span>
          <EditableText
            value={raw}
            onChange={(v) => patch(token.editablePath, v)}
            placeholder="情绪"
            status={editStatus}
            ariaLabel="角色情绪"
          />
          <span>）</span>
        </div>
      );
    }

    case "dialogue": {
      const raw = String(getAtPath(data, token.editablePath) ?? "");
      return (
        <div
          key={`${token.epIndex}-${token.sceneIndex}-${token.actionIndex}-dialogue`}
          className="font-[Geist,sans-serif] text-[15px] text-[var(--color-ink)] ml-[14ch] mr-[14ch] leading-relaxed"
        >
          <EditableText
            value={raw}
            onChange={(v) => patch(token.editablePath, v)}
            placeholder="（对白）"
            multiline
            status={editStatus}
            className="block w-full"
            ariaLabel="对白"
          />
        </div>
      );
    }
  }
}

// ---------------------------------------------------------------------------
// EpisodeBlock — renders one episode from a slice of tokens
// ---------------------------------------------------------------------------

function EpisodeBlock({
  tokens,
  data,
  patch,
  status,
  epTitle,
  episodeId,
  epIndex,
  editablePath,
}: {
  tokens: FountainToken[];
  data: ScriptJson;
  patch: PatchFn;
  status: "idle" | "loading" | "saving" | "saved" | "error";
  epTitle: string | null;
  episodeId: string;
  epIndex: number;
  editablePath: string;
}) {
  const editStatus: "idle" | "saving" | "saved" | "error" =
    status === "loading" ? "idle" : status;

  const rawTitle = String(getAtPath(data, editablePath) ?? epTitle ?? "");

  return (
    <article className="space-y-4">
      {/* Episode header */}
      <header>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-mono text-[11px] text-[var(--color-ink-faint)] uppercase tracking-wider">
            {episodeId}
          </span>
          <span className="font-serif text-[24px] text-[var(--color-ink)]">
            <EditableText
              value={rawTitle}
              onChange={(v) => patch(editablePath, v)}
              placeholder="（本集标题）"
              status={editStatus}
              ariaLabel={`第${epIndex + 1}集标题`}
            />
          </span>
        </div>
        <div className="h-px bg-[var(--color-rule)]" />
      </header>

      {/* Scene tokens */}
      <div className="space-y-4">
        {tokens.map((token) =>
          renderToken(token, data, patch, status),
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// ScriptView — main export
// ---------------------------------------------------------------------------

export function ScriptView({
  projectName,
  path,
}: {
  projectName: string;
  path: string;
}) {
  const { data, error, status, patch, savedAt } =
    useEditableJson<ScriptJson>(projectName, path);

  const handleCopyPath = useCallback(() => {
    const displayPath = `workspace/${projectName}/${path}`;
    void navigator.clipboard.writeText(displayPath).catch(() => undefined);
  }, [projectName, path]);

  if (status === "error" && !data) {
    return (
      <div className="p-6 text-[13px] text-[var(--color-err)]">
        加载失败：{error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-6 text-[13px] text-[var(--color-ink-subtle)]">
        加载中…
      </div>
    );
  }

  const dict = buildRefDict(data);
  const allTokens = buildFountainTokens(data);

  // Group non-episode tokens by epIndex for rendering inside EpisodeBlock
  const epTokenMap = new Map<number, FountainToken[]>();
  const episodeTokens: Array<Extract<FountainToken, { kind: "episode" }>> = [];

  for (const token of allTokens) {
    if (token.kind === "title" || token.kind === "meta") continue;
    if (token.kind === "episode") {
      episodeTokens.push(token);
      if (!epTokenMap.has(token.epIndex)) {
        epTokenMap.set(token.epIndex, []);
      }
      continue;
    }
    const bucket = epTokenMap.get(token.epIndex) ?? [];
    bucket.push(token);
    epTokenMap.set(token.epIndex, bucket);
  }

  const displayPath = `workspace/${projectName}/${path}`;

  return (
    <div className="flex flex-col h-full">
      {/* Top strip */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-[var(--color-rule)] bg-[var(--color-surface)]">
        <button
          onClick={handleCopyPath}
          className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)] transition-colors cursor-pointer"
          title="点击复制路径"
        >
          {displayPath}
        </button>
        <SaveStatusLabel status={status} savedAt={savedAt} error={error} />
      </div>

      {/* Screenplay body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[72ch] mx-auto px-8 py-10">
          {/* Title */}
          {data.title && (
            <h1
              className="font-serif text-[var(--color-ink)] mb-2"
              style={{ fontSize: "clamp(32px, 4vw, 44px)", lineHeight: 1.15 }}
            >
              {data.title}
            </h1>
          )}

          {/* Meta row */}
          {(data.worldview || data.style) && (
            <div className="font-[Geist,sans-serif] text-[13px] italic text-[var(--color-ink-muted)] mb-4 space-y-0.5">
              {data.worldview && (
                <div>
                  <span className="font-mono text-[11px] not-italic uppercase tracking-wider text-[var(--color-ink-subtle)] mr-2">
                    WORLDVIEW
                  </span>
                  {data.worldview}
                </div>
              )}
              {data.style && (
                <div>
                  <span className="font-mono text-[11px] not-italic uppercase tracking-wider text-[var(--color-ink-subtle)] mr-2">
                    STYLE
                  </span>
                  {data.style}
                </div>
              )}
            </div>
          )}

          {/* Ref legend */}
          <RefLegend dict={dict} />

          {/* Rule */}
          <div className="h-px bg-[var(--color-rule-strong)] mb-10" />

          {/* Episodes */}
          <div className="space-y-10">
            {episodeTokens.map((epToken) => (
              <EpisodeBlock
                key={epToken.episodeId}
                tokens={epTokenMap.get(epToken.epIndex) ?? []}
                data={data}
                patch={patch}
                status={status}
                epTitle={epToken.title}
                episodeId={epToken.episodeId}
                epIndex={epToken.epIndex}
                editablePath={epToken.editablePath}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
