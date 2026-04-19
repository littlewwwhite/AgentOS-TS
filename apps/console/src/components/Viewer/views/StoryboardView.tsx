// input: projectName + relPath → storyboard JSON (ep*_storyboard.json) via useEditableJson
//        + sibling output/script.json via useFileJson for placeholder dict
// output: director's shot-deck — scene/clip/shot cards with inline editing of prompts
// pos: StoryboardView panel inside the Viewer; replaces the old prompt-only metadata list

import { useCallback } from "react";
import { useEditableJson } from "../../../hooks/useEditableJson";
import { useFileJson } from "../../../hooks/useFile";
import { buildRefDict, resolveRefs, type ScriptJson } from "../../../lib/fountain";
import { EditableText } from "../../common/EditableText";
import { SaveStatusDot } from "../../common/SaveStatusDot";

// ---------------------------------------------------------------------------
// Schema types (real data shape from ep*_storyboard.json)
// ---------------------------------------------------------------------------

interface ShotRef { shot_id: string; time_range: string; partial_prompt: string; partial_prompt_v2: string; is_overlap: boolean; is_bridge: boolean; }
interface ClipRef { clip_id: string; expected_duration: string; script_source: string; layout_prompt: string; sfx_prompt: string; shots: ShotRef[]; overlap?: unknown | null; bridge_description?: string | null; complete_prompt: string; complete_prompt_v2: string; }
interface EnvRef { space: string; time: string; }
interface SceneRef { scene_id: string; environment: EnvRef; locations: Array<{ location_id: string; state_id?: string | null }>; actors: Array<{ actor_id: string; state_id?: string | null }>; props: Array<{ prop_id: string; state_id?: string | null }>; clips: ClipRef[]; }
interface StoryboardJson { episode_id: string; title: string | null; scenes: SceneRef[]; }

// ---------------------------------------------------------------------------
// getAtPath — same pattern as ScriptView
// ---------------------------------------------------------------------------

function getAtPath(obj: unknown, path: string): unknown {
  const segments = path.split(".");
  let node: unknown = obj;
  for (const seg of segments) {
    if (node === null || node === undefined) return undefined;
    const idx = Number(seg);
    const isIndex = !Number.isNaN(idx) && String(idx) === seg;
    if (isIndex) {
      if (!Array.isArray(node)) return undefined;
      node = (node as unknown[])[idx];
    } else {
      if (typeof node !== "object" || Array.isArray(node)) return undefined;
      node = (node as Record<string, unknown>)[seg];
    }
  }
  return node;
}

// ---------------------------------------------------------------------------
// SaveStatusLabel
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
// Environment code helpers (match ScriptView's spaceCode / timeCode)
// ---------------------------------------------------------------------------

function spaceCode(space: string): string {
  if (space === "interior") return "INT";
  if (space === "exterior") return "EXT";
  return space.toUpperCase();
}

// ---------------------------------------------------------------------------
// FieldLabel — shared prompt field label
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: string }) {
  return (
    <div className="font-[Geist,sans-serif] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-subtle)] mb-1">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShotCard
// ---------------------------------------------------------------------------

function ShotCard({
  shot,
  shotPath,
  data,
  patch,
  status,
  dict,
}: {
  shot: ShotRef;
  shotPath: string;
  data: StoryboardJson;
  patch: (path: string, value: unknown) => void;
  status: "idle" | "loading" | "saving" | "saved" | "error";
  dict: Record<string, string>;
}) {
  const editStatus: "idle" | "saving" | "saved" | "error" =
    status === "loading" ? "idle" : status;

  const pp1Path = `${shotPath}.partial_prompt`;
  const pp2Path = `${shotPath}.partial_prompt_v2`;
  const rawPP1 = String(getAtPath(data, pp1Path) ?? shot.partial_prompt ?? "");
  const rawPP2 = String(getAtPath(data, pp2Path) ?? shot.partial_prompt_v2 ?? "");

  return (
    <div
      className="bg-[var(--color-paper)] px-4 py-3 border-l-2 border-[var(--color-accent)] space-y-3"
    >
      {/* Shot header */}
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-[var(--color-accent)] uppercase tracking-wider">
          {shot.shot_id}
        </span>
        <span className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
          {shot.time_range}
        </span>
        {shot.is_bridge && (
          <span className="font-mono text-[10px] text-[var(--color-accent)] uppercase tracking-wider">
            BRIDGE
          </span>
        )}
        {shot.is_overlap && (
          <span className="font-mono text-[10px] text-[var(--color-accent)] uppercase tracking-wider">
            OVERLAP
          </span>
        )}
      </div>

      {/* Partial prompt V1 */}
      <div>
        <FieldLabel>镜头描述 V1</FieldLabel>
        <div className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] w-full">
          <EditableText
            value={rawPP1}
            onChange={(v) => patch(pp1Path, v)}
            placeholder="（V1 镜头描述）"
            multiline
            status={editStatus}
            className="w-full block"
            ariaLabel={`${shot.shot_id} 镜头描述 V1`}
          />
        </div>
      </div>

      {/* Partial prompt V2 */}
      <div>
        <FieldLabel>镜头描述 V2</FieldLabel>
        <div className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] w-full">
          <EditableText
            value={rawPP2}
            onChange={(v) => patch(pp2Path, v)}
            placeholder="（V2 镜头描述）"
            multiline
            status={editStatus}
            className="w-full block"
            ariaLabel={`${shot.shot_id} 镜头描述 V2`}
          />
        </div>
      </div>

      {/* Resolved V1 preview (non-editable, for quick reference) */}
      {rawPP1 && (
        <div
          className="font-[Geist,sans-serif] text-[11px] italic text-[var(--color-ink-faint)] leading-relaxed"
          title="占位符已解析预览（V1）"
        >
          {resolveRefs(rawPP1, dict).slice(0, 200)}
          {rawPP1.length > 200 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClipCard
// ---------------------------------------------------------------------------

function ClipCard({
  clip,
  clipPath,
  si,
  ci,
  data,
  patch,
  status,
  dict,
}: {
  clip: ClipRef;
  clipPath: string;
  si: number;
  ci: number;
  data: StoryboardJson;
  patch: (path: string, value: unknown) => void;
  status: "idle" | "loading" | "saving" | "saved" | "error";
  dict: Record<string, string>;
}) {
  const editStatus: "idle" | "saving" | "saved" | "error" =
    status === "loading" ? "idle" : status;

  const ssPath = `${clipPath}.script_source`;
  const lpPath = `${clipPath}.layout_prompt`;
  const sfxPath = `${clipPath}.sfx_prompt`;

  const rawSS = String(getAtPath(data, ssPath) ?? clip.script_source ?? "");
  const rawLP = String(getAtPath(data, lpPath) ?? clip.layout_prompt ?? "");
  const rawSFX = String(getAtPath(data, sfxPath) ?? clip.sfx_prompt ?? "");

  const resolvedLP = resolveRefs(rawLP, dict);

  return (
    <div
      className="bg-[var(--color-paper-soft)] px-6 py-5 border border-[var(--color-rule)] space-y-4"
    >
      {/* Clip header */}
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-[12px] text-[var(--color-accent)] uppercase tracking-wider">
          {clip.clip_id}
        </span>
        <span className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
          {clip.expected_duration}
        </span>
      </div>

      {/* Script source */}
      <div>
        <FieldLabel>剧本原文</FieldLabel>
        <div className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] w-full">
          <EditableText
            value={rawSS}
            onChange={(v) => patch(ssPath, v)}
            placeholder="（剧本原文）"
            multiline
            status={editStatus}
            className="w-full block"
            ariaLabel={`${clip.clip_id} 剧本原文`}
          />
        </div>
      </div>

      {/* Layout prompt */}
      <div>
        <FieldLabel>场景布局</FieldLabel>
        <div className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] w-full">
          <EditableText
            value={rawLP}
            onChange={(v) => patch(lpPath, v)}
            placeholder="（场景布局指令）"
            multiline
            status={editStatus}
            className="w-full block"
            ariaLabel={`${clip.clip_id} 场景布局`}
          />
        </div>
        {rawLP && (
          <div className="font-[Geist,sans-serif] text-[11px] italic text-[var(--color-ink-faint)] mt-1 leading-relaxed">
            {resolvedLP.slice(0, 160)}
            {resolvedLP.length > 160 ? "…" : ""}
          </div>
        )}
      </div>

      {/* SFX prompt */}
      <div>
        <FieldLabel>音效指令</FieldLabel>
        <div className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)] w-full">
          <EditableText
            value={rawSFX}
            onChange={(v) => patch(sfxPath, v)}
            placeholder="（音效指令）"
            multiline
            status={editStatus}
            className="w-full block"
            ariaLabel={`${clip.clip_id} 音效指令`}
          />
        </div>
      </div>

      {/* Shots subgrid */}
      {clip.shots.length > 0 && (
        <div className="space-y-3">
          {clip.shots.map((shot, shi) => (
            <ShotCard
              key={shot.shot_id ?? shi}
              shot={shot}
              shotPath={`scenes.${si}.clips.${ci}.shots.${shi}`}
              data={data}
              patch={patch}
              status={status}
              dict={dict}
            />
          ))}
        </div>
      )}

      {/* Complete prompt preview — collapsible, read-only */}
      {(clip.complete_prompt || clip.complete_prompt_v2) && (
        <details className="mt-2">
          <summary className="font-mono text-[11px] text-[var(--color-ink-subtle)] cursor-pointer select-none hover:text-[var(--color-ink)] transition-colors">
            展开合成预览 complete_prompt
          </summary>
          <div className="mt-2 space-y-2">
            <p className="font-[Geist,sans-serif] text-[11px] italic text-[var(--color-warn)]">
              这是由 partial 合成，修改请编辑上方的 V1/V2
            </p>
            {clip.complete_prompt && (
              <pre
                className="font-[Geist,sans-serif] text-[12px] italic text-[var(--color-ink-muted)] whitespace-pre-wrap break-words"
              >
                {resolveRefs(clip.complete_prompt, dict)}
              </pre>
            )}
            {clip.complete_prompt_v2 && (
              <pre
                className="font-[Geist,sans-serif] text-[12px] italic text-[var(--color-ink-muted)] whitespace-pre-wrap break-words"
              >
                {resolveRefs(clip.complete_prompt_v2, dict)}
              </pre>
            )}
          </div>
        </details>
      )}

      {/* Bridge description — read-only */}
      {clip.bridge_description && (
        <div className="font-[Geist,sans-serif] text-[12px] italic text-[var(--color-ink-muted)]">
          过场：{clip.bridge_description}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SceneSection
// ---------------------------------------------------------------------------

function SceneSection({
  scene,
  si,
  data,
  patch,
  status,
  dict,
}: {
  scene: SceneRef;
  si: number;
  data: StoryboardJson;
  patch: (path: string, value: unknown) => void;
  status: "idle" | "loading" | "saving" | "saved" | "error";
  dict: Record<string, string>;
}) {
  const env = scene.environment;
  const spCode = spaceCode(env.space);
  const timeCode = env.time.toUpperCase();

  // Resolve first location name for scene heading
  const firstLocId = scene.locations?.[0]?.location_id ?? null;
  const firstLocName = firstLocId ? (dict[firstLocId] ?? firstLocId) : null;

  // Resolve actor names
  const actorNames = scene.actors
    .map((a) => dict[a.actor_id] ?? a.actor_id)
    .join(" · ");

  // Resolve prop names
  const propNames = scene.props
    .map((p) => dict[p.prop_id] ?? p.prop_id)
    .join(" · ");

  const headingParts: string[] = [scene.scene_id.toUpperCase(), spCode, timeCode];
  if (firstLocName) headingParts.push(firstLocName);

  return (
    <section className="border-t border-[var(--color-rule-strong)] pt-8 space-y-4">
      {/* Scene header */}
      <div className="space-y-0.5">
        <div className="font-mono text-[11px] text-[var(--color-ink-faint)] uppercase tracking-wider">
          {headingParts.join(" · ")}
        </div>
        {(actorNames || propNames) && (
          <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
            {actorNames && <span>演员：{actorNames}</span>}
            {actorNames && propNames && <span className="mx-2">　</span>}
            {propNames && <span>道具：{propNames}</span>}
          </div>
        )}
      </div>

      {/* Clip cards */}
      <div className="space-y-4">
        {scene.clips.map((clip, ci) => (
          <ClipCard
            key={clip.clip_id ?? ci}
            clip={clip}
            clipPath={`scenes.${si}.clips.${ci}`}
            si={si}
            ci={ci}
            data={data}
            patch={patch}
            status={status}
            dict={dict}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// StoryboardView — main export
// ---------------------------------------------------------------------------

export function StoryboardView({ projectName, path }: { projectName: string; path: string }) {
  const { data, error, status, patch, savedAt } =
    useEditableJson<StoryboardJson>(projectName, path);

  // Derive sibling script.json path: replace the ep* filename with output/script.json
  // path looks like: output/ep001/ep001_storyboard.json
  // script.json is at:               output/script.json
  const scriptPath = path.replace(/output\/ep[^/]+\/[^/]+$/, "output/script.json");
  const { data: scriptData } = useFileJson<ScriptJson>(projectName, scriptPath);

  const dict = scriptData ? buildRefDict(scriptData) : {};

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

  const scenes = data.scenes ?? [];

  // Compute totals for header stats
  const totalClips = scenes.reduce((acc, sc) => acc + (sc.clips?.length ?? 0), 0);
  const totalShots = scenes.reduce(
    (acc, sc) =>
      acc + sc.clips.reduce((a2, cl) => a2 + (cl.shots?.length ?? 0), 0),
    0,
  );

  const displayPath = `workspace/${projectName}/${path}`;

  // Build ref dict entries for the legend
  const dictEntries = Object.entries(dict);

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

      {/* Storyboard body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[920px] mx-auto px-10 py-10 space-y-10">

          {/* Header */}
          <header className="space-y-1">
            <h1 className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
              {data.title ? data.title : `${data.episode_id} 分镜脚本`}
            </h1>
            <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
              {scenes.length} 场 · {totalClips} 片段 · {totalShots} 镜
            </div>
          </header>

          {/* Ref legend — collapsible */}
          {dictEntries.length > 0 && (
            <details className="border border-[var(--color-rule)] px-4 py-3">
              <summary className="font-mono text-[11px] text-[var(--color-ink-subtle)] cursor-pointer select-none hover:text-[var(--color-ink)] transition-colors">
                参考表（{dictEntries.length} 项）
              </summary>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-[var(--color-ink-subtle)]">
                {dictEntries.map(([id, name]) => (
                  <span key={id}>
                    <span className="text-[var(--color-ink-faint)]">{`{${id}}`}</span>
                    <span className="ml-1">{name}</span>
                  </span>
                ))}
              </div>
            </details>
          )}

          {/* Scenes */}
          {scenes.map((scene, si) => (
            <SceneSection
              key={scene.scene_id ?? si}
              scene={scene}
              si={si}
              data={data}
              patch={patch}
              status={status}
              dict={dict}
            />
          ))}

        </div>
      </div>
    </div>
  );
}
