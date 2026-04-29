// input: projectName + relPath → storyboard JSON (ep*_storyboard.json)
//        + output/script.json and draft/catalog.json for placeholder dictionaries
// output: pre-video storyboard editor with clip preview and episode timing map
// pos: StoryboardView panel inside the Viewer

import {
  Fragment,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditableJson, getAtPath } from "../../../hooks/useEditableJson";
import { useFileJson } from "../../../hooks/useFile";
import { useProject } from "../../../contexts/ProjectContext";
import { buildRefDict, resolveRefs, type ScriptJson } from "../../../lib/fountain";
import { fileUrl } from "../../../lib/fileUrl";
import {
  buildClipInspectorData,
  buildProductionAssetRailModel,
  buildStoryboardEditorModel,
  buildStoryboardGenerationUnits,
  findScriptSceneSnapshot,
  parseDraftStoryboardPrompt,
  resolveStoryboardSelectionAtTime,
  storyboardPromptAsMarkdown,
  summarizeSourceRefs,
  splitStoryboardText,
  type ClipInspectorData,
  type DraftStoryboardPromptSummary,
  type ScriptSceneSnapshot,
  type StoryboardClipLike,
  type StoryboardEditorClip,
  type StoryboardEditorShot,
  type StoryboardGenerationUnit,
  type StoryboardSceneLike,
  type StoryboardShotLike,
} from "../../../lib/storyboard";
import { EditableText } from "../../common/EditableText";
import { SaveStatusDot } from "../../common/SaveStatusDot";
import { ArtifactLifecycleActions } from "../../common/ArtifactLifecycleActions";
import { PromptChipEditor, type PromptCatalog } from "./PromptChipEditor";
import { ProductionAssetRail } from "../review/ProductionAssetRail";
import { SegmentTimeline } from "../review/SegmentTimeline";

interface ShotRef extends StoryboardShotLike {
  shot_id: string;
  time_range: string;
  partial_prompt: string;
  partial_prompt_v2?: string;
}

interface ClipRef extends StoryboardClipLike {
  clip_id: string;
  shots?: ShotRef[];
  overlap?: unknown | null;
  bridge_description?: string | null;
}

interface EnvRef { space?: string; time?: string; }
interface SceneRef extends StoryboardSceneLike {
  scene_id: string;
  environment?: EnvRef;
  locations?: Array<{ location_id: string; state_id?: string | null }>;
  actors?: Array<{ actor_id: string; state_id?: string | null }>;
  props?: Array<{ prop_id: string; state_id?: string | null }>;
  clips?: ClipRef[];
}

interface StoryboardJson {
  episode_id: string;
  title?: string | null;
  scenes?: SceneRef[];
  scene_id?: string;
  shots?: DraftStoryboardPart[];
}

interface DraftStoryboardPart {
  source_refs?: unknown;
  prompt?: string;
}

type PlaybackStatus = "idle" | "playing" | "paused";
type EpisodePreviewStatus = "idle" | "building" | "ready" | "error";

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
  if (status === "saving") label = "保存中…";
  else if (status === "saved") label = `已保存${savedAtLabel(savedAt)}`;
  else if (status === "error") label = `保存失败：${error ?? "未知错误"}`;
  else label = "未修改";

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

function FieldLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 font-[Geist,sans-serif] text-[11px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
      {children}
    </div>
  );
}

function MetaBadge({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 border border-[var(--color-rule)] bg-[var(--color-paper)] px-2 py-1">
      <span className="font-[Geist,sans-serif] text-[10px] tracking-[0.08em] text-[var(--color-ink-faint)]">
        {label}
      </span>
      <span className="font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-muted)]">
        {value}
      </span>
    </span>
  );
}

function InfoPanelSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <FieldLabel>{title}</FieldLabel>
      <div className="whitespace-pre-wrap break-words font-[Geist,sans-serif] text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
        {children}
      </div>
    </section>
  );
}

function summarizeText(text: string, limit = 240): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}…`;
}

function durationLabel(duration: number): string {
  return `${duration.toFixed(duration % 1 === 0 ? 0 : 1)}s`;
}

function syntheticClipData(clip: StoryboardEditorClip): ClipRef {
  return {
    clip_id: clip.clipId,
    expected_duration: clip.expectedDuration ?? undefined,
    script_source: clip.displayText,
    shots: clip.shots.map((shot) => ({
      shot_id: shot.shotId,
      time_range: shot.timeRange ?? durationLabel(shot.duration),
      duration: shot.duration,
      partial_prompt: shot.prompt,
    })),
  };
}

function PreviewStage({
  projectName,
  videoPath,
  clip,
  exists,
  placeholderTitle,
  videoRef,
  onLoadedMetadata,
  onTimeUpdate,
  onEnded,
  onPlay,
  onPause,
}: {
  projectName: string;
  videoPath: string | null;
  clip: StoryboardEditorClip;
  exists: boolean;
  placeholderTitle: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
  onPlay: () => void;
  onPause: () => void;
}) {
  return (
    <section className="flex min-h-0 min-w-0 items-center justify-center border border-[var(--color-rule)] bg-[var(--color-paper)] p-3">
      <div className="relative mx-auto aspect-[9/16] h-full max-h-[68vh] min-h-[360px] max-w-full overflow-hidden border border-[var(--color-rule)] bg-[var(--color-ink)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.42)_100%)]" />
        {exists ? (
          <video
            key={videoPath ?? clip.key}
            ref={videoRef}
            controls
            preload="metadata"
            src={videoPath ? fileUrl(projectName, videoPath) : undefined}
            className="relative z-10 h-full w-full object-contain bg-black"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
            onPlay={onPlay}
            onPause={onPause}
          />
        ) : (
          <div className="relative z-10 flex h-full items-center justify-center px-6 text-center">
            <div className="space-y-3">
              <div className="font-serif text-[22px] italic text-white/88">
                {placeholderTitle}
              </div>
              <div className="mx-auto max-w-[28rem] font-[Geist,sans-serif] text-[13px] leading-relaxed text-white/68">
                视频生成后会在此预览；当前可先校对右侧提示词与剧本原文。
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ClipInfoPanel({
  summary,
  source,
  selectedShot,
  dict,
  children,
  className = "",
}: {
  summary: ClipInspectorData;
  source: string;
  selectedShot: StoryboardEditorShot | null;
  dict: Record<string, string>;
  children?: ReactNode;
  className?: string;
}) {
  const scriptBeats = splitStoryboardText(source, dict);

  return (
    <aside className={`min-w-0 border border-[var(--color-rule)] bg-[var(--color-paper)] px-4 py-3 ${className}`.trim()}>
      <div className="space-y-4">
        {(summary.environment || summary.location) && (
          <div className="flex flex-wrap gap-2">
            {summary.environment && <MetaBadge label="场域" value={summary.environment} />}
            {summary.location && <MetaBadge label="场景" value={summary.location} />}
            {summary.expectedDuration && <MetaBadge label="预估" value={summary.expectedDuration} />}
          </div>
        )}

        {selectedShot && (
          <InfoPanelSection title="当前镜头">
            {selectedShot.prompt || "（无镜头提示词）"}
          </InfoPanelSection>
        )}

        {summary.characters.length > 0 && (
          <InfoPanelSection title="出场人物">
            <div className="flex flex-wrap gap-2">
              {summary.characters.map((character) => (
                <MetaBadge key={character} label="角色" value={character} />
              ))}
            </div>
          </InfoPanelSection>
        )}

        {summary.props.length > 0 && (
          <InfoPanelSection title="场景道具">
            <div className="flex flex-wrap gap-2">
              {summary.props.map((prop) => (
                <MetaBadge key={prop} label="道具" value={prop} />
              ))}
            </div>
          </InfoPanelSection>
        )}

        <InfoPanelSection title="剧本原文">
          {scriptBeats.length === 0 ? (
            <span className="font-serif italic text-[14px] text-[var(--color-ink-faint)]">
              （无剧本原文）
            </span>
          ) : (
            <ol className="space-y-2">
              {scriptBeats.map((beat, index) => (
                <li key={`${index}-${beat}`} className="grid grid-cols-[24px_1fr] gap-3">
                  <span className="pt-0.5 font-mono text-[10px] text-[var(--color-ink-faint)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="font-serif italic text-[14px] leading-relaxed text-[var(--color-ink)]">
                    {beat}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </InfoPanelSection>

        {summary.layoutPrompt && (
          <InfoPanelSection title="场面提示词">
            {summary.layoutPrompt}
          </InfoPanelSection>
        )}

        {summary.sfxPrompt && (
          <InfoPanelSection title="音轨提示词">
            {summary.sfxPrompt}
          </InfoPanelSection>
        )}

        {summary.promptPreview && (
          <InfoPanelSection title="合成提示词摘要">
            {summarizeText(summary.promptPreview, 280)}
          </InfoPanelSection>
        )}

        {children}
      </div>
    </aside>
  );
}

function ShotList({
  shots,
  dict,
}: {
  shots: ShotRef[];
  dict: Record<string, string>;
}) {
  if (shots.length === 0) return null;

  return (
    <details className="border-t border-[var(--color-rule)] pt-3">
      <summary className="cursor-pointer select-none font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]">
        展开镜头轨明细（{shots.length} 镜）
      </summary>
      <div className="mt-3 space-y-3">
        {shots.map((shot, index) => (
          <div
            key={shot.shot_id ?? index}
            className="grid grid-cols-[72px_1fr] gap-3 border-l-2 border-[var(--color-accent)] pl-3"
          >
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-accent)]">
                {shot.shot_id}
              </div>
              <div className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                {shot.time_range}
              </div>
            </div>
            <div className="font-[Geist,sans-serif] text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              {resolveRefs(shot.partial_prompt ?? "", dict)}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function EditableClipFields({
  clip,
  clipPath,
  data,
  patch,
  status,
  readOnly,
}: {
  clip: ClipRef;
  clipPath: string;
  data: StoryboardJson;
  patch: (path: string, value: unknown) => void;
  status: "idle" | "loading" | "saving" | "saved" | "error";
  readOnly: boolean;
}) {
  const editStatus: "idle" | "saving" | "saved" | "error" =
    status === "loading" ? "idle" : status;

  const ssPath = `${clipPath}.script_source`;
  const lpPath = `${clipPath}.layout_prompt`;
  const sfxPath = `${clipPath}.sfx_prompt`;

  const rawSS = String(getAtPath(data, ssPath) ?? clip.script_source ?? "");
  const rawLP = String(getAtPath(data, lpPath) ?? clip.layout_prompt ?? "");
  const rawSFX = String(getAtPath(data, sfxPath) ?? clip.sfx_prompt ?? "");

  return (
    <details className="border-t border-[var(--color-rule)] pt-3">
      <summary className="cursor-pointer select-none font-mono text-[11px] text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]">
        原始字段 / 可编辑
      </summary>
      <div className="mt-3 space-y-4">
        <div>
          <FieldLabel>剧本原文</FieldLabel>
          <div className="w-full font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)]">
            <EditableText
              value={rawSS}
              onChange={(value) => patch(ssPath, value)}
              placeholder="（剧本原文）"
              multiline
              status={editStatus}
              className="block w-full"
              ariaLabel={`${clip.clip_id} 剧本原文`}
              readOnly={readOnly}
            />
          </div>
        </div>
        <div>
          <FieldLabel>场景布局</FieldLabel>
          <div className="w-full font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)]">
            <EditableText
              value={rawLP}
              onChange={(value) => patch(lpPath, value)}
              placeholder="（场景布局指令）"
              multiline
              status={editStatus}
              className="block w-full"
              ariaLabel={`${clip.clip_id} 场景布局`}
              readOnly={readOnly}
            />
          </div>
        </div>
        <div>
          <FieldLabel>音效指令</FieldLabel>
          <div className="w-full font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)]">
            <EditableText
              value={rawSFX}
              onChange={(value) => patch(sfxPath, value)}
              placeholder="（音效指令）"
              multiline
              status={editStatus}
              className="block w-full"
              ariaLabel={`${clip.clip_id} 音效指令`}
              readOnly={readOnly}
            />
          </div>
        </div>
      </div>
    </details>
  );
}

function isDraftStoryboard(data: StoryboardJson): data is StoryboardJson & { shots: DraftStoryboardPart[] } {
  return Array.isArray(data.shots) && (!Array.isArray(data.scenes) || data.scenes.length === 0);
}

function DraftShotSummaryList({ summary }: { summary: DraftStoryboardPromptSummary }) {
  if (summary.shots.length === 0) {
    return (
      <div className="font-[Geist,sans-serif] text-[12px] italic text-[var(--color-ink-faint)]">
        未解析到内嵌 shots 结构；仍可安全编辑外层 prompt 字段。
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      {summary.shots.map((shot) => (
        <div
          key={`${shot.shotId}-${shot.timeRange ?? "na"}`}
          className="grid grid-cols-[56px_92px_minmax(0,1fr)] items-center gap-3 border-l-2 border-[var(--color-accent)] bg-[var(--color-paper-soft)] px-3 py-2"
        >
          <span className="font-mono text-[11px] font-semibold text-[var(--color-accent)]">
            {shot.shotId}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-ink-subtle)]">
            {shot.timeRange ?? "未标时"}
          </span>
          <span className="truncate font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-muted)]">
            {shot.cameraType ?? "未标镜型"}
          </span>
        </div>
      ))}
    </div>
  );
}

function DraftStoryboardEditor({
  data,
  path,
  projectName,
  status,
  savedAt,
  error,
  onActionDone,
}: {
  data: StoryboardJson & { shots: DraftStoryboardPart[] };
  path: string;
  projectName: string;
  patch: (path: string, value: unknown) => void;
  status: "idle" | "loading" | "saving" | "saved" | "error";
  savedAt: number | null;
  error: string | null;
  readOnly: boolean;
  onActionDone: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-6 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-6 py-3 shrink-0">
        <header className="space-y-1">
          <h1 className="font-serif text-[24px] leading-tight text-[var(--color-ink)]">
            {data.episode_id} 故事板草稿
          </h1>
        </header>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SaveStatusLabel status={status} savedAt={savedAt} error={error} />
          <ArtifactLifecycleActions projectName={projectName} path={path} onActionDone={onActionDone} />
          <MetaBadge label="场景" value={data.scene_id ?? "未标注"} />
          <MetaBadge label="分段" value={`${data.shots.length}`} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-paper-sunk)] px-6 py-6">
        <div className="mx-auto grid max-w-[1040px] gap-4">
          {data.shots.map((part, partIndex) => {
            const prompt = typeof part.prompt === "string" ? part.prompt : "";
            const summary = parseDraftStoryboardPrompt(prompt);

            return (
              <section
                key={`${partIndex}-${summary.partLabel}`}
                className="border border-[var(--color-rule)] bg-[var(--color-paper)] px-4 py-4"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-[12px] font-semibold text-[var(--color-accent)]">
                      {summary.partLabel}
                    </div>
                    {summary.summary && (
                      <div className="mt-1 max-w-[72ch] font-[Geist,sans-serif] text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                        {summary.summary}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <MetaBadge label="原文 refs" value={summarizeSourceRefs(part.source_refs)} />
                    <MetaBadge label="镜头" value={`${summary.shots.length}`} />
                  </div>
                </div>

                <DraftShotSummaryList summary={summary} />
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function projectTreePaths(tree: unknown): string[] {
  if (!Array.isArray(tree)) return [];
  const results: string[] = [];
  for (const node of tree) {
    if (!node || typeof node !== "object") continue;
    const { path, children } = node as { path?: unknown; children?: unknown };
    if (typeof path === "string" && path.trim()) {
      results.push(path);
    }
    if (Array.isArray(children)) {
      results.push(...projectTreePaths(children));
    }
  }
  return results;
}

type JsonPatch = (path: string, value: unknown) => void;

function buildPromptCatalog(
  ...sources: Array<ScriptJson | undefined | null>
): PromptCatalog {
  const actorMap = new Map<string, string>();
  const locationMap = new Map<string, string>();
  const propMap = new Map<string, string>();
  for (const source of sources) {
    for (const actor of source?.actors ?? []) {
      const id = actor.actor_id;
      const name = actor.actor_name;
      if (id && name && !actorMap.has(id)) actorMap.set(id, name);
    }
    for (const loc of source?.locations ?? []) {
      const id = loc.location_id;
      const name = loc.location_name;
      if (id && name && !locationMap.has(id)) locationMap.set(id, name);
    }
    for (const prop of source?.props ?? []) {
      const id = prop.prop_id;
      const name = prop.prop_name;
      if (id && name && !propMap.has(id)) propMap.set(id, name);
    }
  }
  const toEntries = (map: Map<string, string>) =>
    Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.id.localeCompare(b.id));
  return {
    actor: toEntries(actorMap),
    location: toEntries(locationMap),
    prop: toEntries(propMap),
  };
}

function StoryboardPromptEditor({
  unit,
  patch,
  readOnly,
  dict,
  catalog,
  actorStateOverrides,
  stateNameById,
}: {
  unit: StoryboardGenerationUnit;
  patch: JsonPatch;
  readOnly: boolean;
  dict: Record<string, string>;
  catalog: PromptCatalog;
  actorStateOverrides?: Map<string, string>;
  stateNameById?: Record<string, string>;
}) {
  return (
    <PromptChipEditor
      ariaLabel={`${unit.sceneId} ${unit.partId} 生成视频 prompt`}
      value={unit.rawPrompt}
      dict={dict}
      catalog={catalog}
      readOnly={readOnly}
      placeholder="用一段自然语言描述这一镜头要拍什么"
      actorStateOverrides={actorStateOverrides}
      stateNameById={stateNameById}
      onChange={(next) => patch(unit.promptPath, next)}
    />
  );
}

function ScriptActionItem({
  scene,
  index,
}: {
  scene: ScriptSceneSnapshot;
  index: number;
}) {
  const action = scene.actions[index];
  if (!action) return null;
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
      <span className="pt-1 font-mono text-[10px] text-[var(--color-ink-faint)]">
        {String(index + 1).padStart(2, "0")}
      </span>
      {action.kind === "dialogue" ? (
        <div className="space-y-0.5">
          {action.actorName && (
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
              {action.actorName}
            </div>
          )}
          <div className="font-serif italic text-[14px] leading-relaxed text-[var(--color-ink)]">
            {action.text}
          </div>
        </div>
      ) : (
        <div className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-[var(--color-ink)]">
          {action.text}
        </div>
      )}
    </li>
  );
}

function ScriptActionGroup({
  scene,
  indices,
}: {
  scene: ScriptSceneSnapshot;
  indices: number[];
}) {
  if (indices.length === 0) {
    return <div aria-hidden className="min-h-[1px]" />;
  }
  return (
    <ol className="space-y-2.5">
      {indices.map((index) => (
        <ScriptActionItem
          key={`${scene.sceneId}-${index}`}
          scene={scene}
          index={index}
        />
      ))}
    </ol>
  );
}

function StoryboardPartBlock({
  unit,
  patch,
  readOnly,
  dict,
  catalog,
  actorStateOverrides,
  stateNameById,
}: {
  unit: StoryboardGenerationUnit;
  patch: JsonPatch;
  readOnly: boolean;
  dict: Record<string, string>;
  catalog: PromptCatalog;
  actorStateOverrides?: Map<string, string>;
  stateNameById?: Record<string, string>;
}) {
  return (
    <StoryboardPromptEditor
      unit={unit}
      patch={patch}
      readOnly={readOnly}
      dict={dict}
      catalog={catalog}
      actorStateOverrides={actorStateOverrides}
      stateNameById={stateNameById}
    />
  );
}

function ReviewPromptPanel({
  unit,
  scriptScene,
  selectedShot,
  patch,
  readOnly,
  dict,
  catalog,
  actorStateOverrides,
  stateNameById,
}: {
  unit: StoryboardGenerationUnit;
  scriptScene: ScriptSceneSnapshot | null;
  selectedShot: StoryboardEditorShot | null;
  patch: JsonPatch;
  readOnly: boolean;
  dict: Record<string, string>;
  catalog: PromptCatalog;
  actorStateOverrides?: Map<string, string>;
  stateNameById?: Record<string, string>;
}) {
  const sourceIndices = scriptScene
    ? unit.sourceRefs.filter((ref) => ref >= 0 && ref < scriptScene.actions.length)
    : [];

  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] border border-[var(--color-rule)] bg-[var(--color-paper)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-rule)] px-4 py-3">
        <div className="min-w-0">
          <div className="font-serif text-[18px] leading-tight text-[var(--color-ink)]">
            {unit.sceneId} · {unit.partId}
          </div>
          <div className="font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)]">
            当前选择的提示词、镜头和剧本原文
          </div>
        </div>
        {selectedShot && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <MetaBadge label="镜头" value={selectedShot.shotId} />
            <MetaBadge label="时间" value={selectedShot.timeRange ?? durationLabel(selectedShot.duration)} />
          </div>
        )}
      </div>

      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-3">
        {selectedShot && (
          <InfoPanelSection title="当前镜头">
            {selectedShot.prompt || "（无镜头提示词）"}
          </InfoPanelSection>
        )}

        <InfoPanelSection title="剧本原文">
          {scriptScene && sourceIndices.length > 0 ? (
            <ScriptActionGroup scene={scriptScene} indices={sourceIndices} />
          ) : (
            <span className="font-serif italic text-[14px] text-[var(--color-ink-faint)]">
              （无剧本原文）
            </span>
          )}
        </InfoPanelSection>

        <div>
          <FieldLabel>生成视频 prompt</FieldLabel>
          <StoryboardPromptEditor
            unit={unit}
            patch={patch}
            readOnly={readOnly}
            dict={dict}
            catalog={catalog}
            actorStateOverrides={actorStateOverrides}
            stateNameById={stateNameById}
          />
        </div>
      </div>
    </aside>
  );
}

function buildPartActionGroups(
  units: StoryboardGenerationUnit[],
  scriptScene: ScriptSceneSnapshot,
): { groups: number[][]; tail: number[] } {
  const groups: number[][] = units.map(() => []);
  const claimed = new Set<number>();
  units.forEach((unit, partIdx) => {
    for (const ref of unit.sourceRefs) {
      if (ref < 0 || ref >= scriptScene.actions.length) continue;
      if (claimed.has(ref)) continue;
      claimed.add(ref);
      groups[partIdx].push(ref);
    }
  });
  const tail: number[] = [];
  for (let i = 0; i < scriptScene.actions.length; i++) {
    if (!claimed.has(i)) tail.push(i);
  }
  // If any part declared no refs at all, attach unclaimed actions sequentially
  // until we run out, so the left column still flows.
  for (let i = 0; i < units.length && tail.length > 0; i++) {
    if (units[i].sourceRefs.length === 0) {
      groups[i].push(tail.shift()!);
      i--;
    }
  }
  return { groups, tail };
}

function StoryboardSceneGroup({
  sceneId,
  units,
  scriptScene,
  patch,
  readOnly,
  dict,
  catalog,
  actorStateOverrides,
  stateNameById,
}: {
  sceneId: string;
  units: StoryboardGenerationUnit[];
  scriptScene: ScriptSceneSnapshot | null;
  patch: JsonPatch;
  readOnly: boolean;
  dict: Record<string, string>;
  catalog: PromptCatalog;
  actorStateOverrides?: Map<string, string>;
  stateNameById?: Record<string, string>;
}) {
  const showScript = scriptScene !== null && scriptScene.actions.length > 0;
  const sceneActorEntries: Array<{ actorId: string; name: string; stateLabel: string }> = [];
  if (actorStateOverrides) {
    for (const [actorId, stateId] of actorStateOverrides) {
      if (!stateId || stateId === "default") continue;
      sceneActorEntries.push({
        actorId,
        name: dict[actorId] ?? actorId,
        stateLabel: stateNameById?.[stateId] ?? stateId,
      });
    }
  }

  const partAction = showScript
    ? buildPartActionGroups(units, scriptScene)
    : null;

  const renderPart = (unit: StoryboardGenerationUnit) => (
    <StoryboardPartBlock
      key={unit.key}
      unit={unit}
      patch={patch}
      readOnly={readOnly}
      dict={dict}
      catalog={catalog}
      actorStateOverrides={actorStateOverrides}
      stateNameById={stateNameById}
    />
  );

  return (
    <article className="border border-[var(--color-rule)] bg-[var(--color-paper)] px-4 py-4">
      <header className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-rule)] pb-2">
        <span className="font-serif text-[16px] text-[var(--color-ink)]">{sceneId}</span>
        {sceneActorEntries.length > 0 && (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-[Geist,sans-serif] text-[11px] text-[var(--color-ink-subtle)]">
            <span className="font-mono uppercase tracking-wider text-[var(--color-ink-faint)]">
              本场状态
            </span>
            {sceneActorEntries.map((entry) => (
              <span
                key={entry.actorId}
                className="border border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-1.5 py-0.5"
              >
                <span className="text-[var(--color-ink)]">{entry.name}</span>
                <span className="ml-1 text-[var(--color-ink-faint)]">
                  （{entry.stateLabel}）
                </span>
              </span>
            ))}
          </span>
        )}
      </header>
      {showScript && scriptScene && partAction ? (
        <div
          className="grid items-start gap-x-4 gap-y-6 lg:gap-x-5"
          style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.3fr)" }}
        >
          {units.map((unit, partIdx) => (
            <Fragment key={unit.key}>
              <ScriptActionGroup scene={scriptScene} indices={partAction.groups[partIdx]} />
              {renderPart(unit)}
            </Fragment>
          ))}
          {partAction.tail.length > 0 && (
            <>
              <ScriptActionGroup scene={scriptScene} indices={partAction.tail} />
              <div aria-hidden />
            </>
          )}
        </div>
      ) : (
        <div className="grid items-start gap-4">{units.map(renderPart)}</div>
      )}
    </article>
  );
}

function StoryboardGenerationUnitList({
  units,
  sceneLookup,
  patch,
  readOnly,
  dict,
  catalog,
  sceneActorStateLookup,
  stateNameById,
}: {
  units: StoryboardGenerationUnit[];
  sceneLookup: Map<string, ScriptSceneSnapshot>;
  patch: JsonPatch;
  readOnly: boolean;
  dict: Record<string, string>;
  catalog: PromptCatalog;
  sceneActorStateLookup: Map<string, Map<string, string>>;
  stateNameById: Record<string, string>;
}) {
  const sceneGroups = useMemo(() => {
    const order: string[] = [];
    const groups = new Map<string, StoryboardGenerationUnit[]>();
    for (const unit of units) {
      const existing = groups.get(unit.sceneId);
      if (existing) {
        existing.push(unit);
      } else {
        order.push(unit.sceneId);
        groups.set(unit.sceneId, [unit]);
      }
    }
    return order.map((sceneId) => ({ sceneId, units: groups.get(sceneId) ?? [] }));
  }, [units]);

  return (
    <section className="grid items-start gap-4">
      {sceneGroups.map((group) => (
        <StoryboardSceneGroup
          key={group.sceneId}
          sceneId={group.sceneId}
          units={group.units}
          scriptScene={sceneLookup.get(group.sceneId) ?? null}
          patch={patch}
          readOnly={readOnly}
          dict={dict}
          catalog={catalog}
          actorStateOverrides={sceneActorStateLookup.get(group.sceneId)}
          stateNameById={stateNameById}
        />
      ))}
    </section>
  );
}

function scriptPathFor(storyboardPath: string): string {
  if (storyboardPath.startsWith("output/")) return "output/script.json";
  if (storyboardPath.endsWith(".shots.json")) return "output/script.json";
  return storyboardPath.replace(/(?:^|\/)[^/]+_storyboard\.json$/, "script.json");
}

export function StoryboardView({ projectName, path }: { projectName: string; path: string }) {
  const { tree, refresh, state } = useProject();
  const { data, error, status, patch, savedAt } =
    useEditableJson<StoryboardJson>(projectName, path);
  const locked = state?.artifacts?.[path]?.status === "locked" || state?.artifacts?.[path]?.editable === false;

  const { data: scriptData } = useFileJson<ScriptJson>(projectName, scriptPathFor(path));
  const { data: catalogData } = useFileJson<ScriptJson>(projectName, "draft/catalog.json");

  useEffect(() => {
    if (savedAt !== null) refresh();
  }, [refresh, savedAt]);

  const dict = useMemo(
    () => ({
      ...buildRefDict(catalogData ?? {}),
      ...buildRefDict(scriptData ?? {}),
    }),
    [catalogData, scriptData],
  );
  const promptCatalog = useMemo(
    () => buildPromptCatalog(catalogData, scriptData),
    [catalogData, scriptData],
  );
  const stateNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const source of [catalogData, scriptData]) {
      for (const actor of source?.actors ?? []) {
        for (const state of actor.states ?? []) {
          if (state.state_id && state.state_name && !map[state.state_id]) {
            map[state.state_id] = state.state_name;
          }
        }
      }
    }
    return map;
  }, [catalogData, scriptData]);

  const treePathList = useMemo(() => projectTreePaths(tree), [tree]);
  const treePaths = useMemo(() => new Set(treePathList), [treePathList]);
  const scenes = data?.scenes ?? [];
  const generationUnits = useMemo(
    () => buildStoryboardGenerationUnits(scenes),
    [scenes],
  );
  const scriptSceneLookup = useMemo(() => {
    const lookup = new Map<string, ScriptSceneSnapshot>();
    for (const scene of scenes) {
      const sceneId = scene?.scene_id;
      if (!sceneId || lookup.has(sceneId)) continue;
      const snapshot = findScriptSceneSnapshot(scriptData, sceneId, dict);
      if (snapshot) lookup.set(sceneId, snapshot);
    }
    return lookup;
  }, [dict, scenes, scriptData]);
  const sceneActorStateLookup = useMemo(() => {
    const lookup = new Map<string, Map<string, string>>();
    const scriptSceneById = new Map<
      string,
      ReadonlyArray<{ actor_id: string; state_id?: string | null }>
    >();
    for (const ep of scriptData?.episodes ?? []) {
      for (const sc of ep.scenes ?? []) {
        if (sc.scene_id && sc.actors) scriptSceneById.set(sc.scene_id, sc.actors);
      }
    }
    for (const scene of scenes) {
      const sceneId = scene?.scene_id;
      if (!sceneId) continue;
      const map = new Map<string, string>();
      for (const a of scene.actors ?? []) {
        if (a.actor_id && a.state_id) map.set(a.actor_id, a.state_id);
      }
      // Backfill from script.json scenes for actors missing a state on the storyboard side.
      for (const a of scriptSceneById.get(sceneId) ?? []) {
        if (a.actor_id && a.state_id && !map.has(a.actor_id)) {
          map.set(a.actor_id, a.state_id);
        }
      }
      lookup.set(sceneId, map);
    }
    return lookup;
  }, [scenes, scriptData]);
  const editorModel = useMemo(
    () => buildStoryboardEditorModel(path, scenes, dict, treePathList),
    [dict, path, scenes, treePathList],
  );

  const [currentClipKey, setCurrentClipKey] = useState<string | null>(editorModel.defaultClipKey);
  const [selectedShotKey, setSelectedShotKey] = useState<string | null>(editorModel.defaultShotKey);
  const [episodeTime, setEpisodeTime] = useState(0);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>("idle");
  const [generatedEpisodeVideoPath, setGeneratedEpisodeVideoPath] = useState<string | null>(null);
  const [episodePreviewStatus, setEpisodePreviewStatus] = useState<EpisodePreviewStatus>("idle");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingSeekRef = useRef<number | null>(0);
  const pendingAutoplayRef = useRef(false);
  const episodeTimeRef = useRef(0);
  const playbackStatusRef = useRef<PlaybackStatus>("idle");

  useEffect(() => {
    episodeTimeRef.current = episodeTime;
  }, [episodeTime]);

  useEffect(() => {
    playbackStatusRef.current = playbackStatus;
  }, [playbackStatus]);

  useEffect(() => {
    setGeneratedEpisodeVideoPath(null);
    setEpisodePreviewStatus("idle");
    pendingSeekRef.current = 0;
    pendingAutoplayRef.current = false;
  }, [path, projectName]);

  const clipMap = useMemo(
    () => new Map(editorModel.clips.map((clip) => [clip.key, clip])),
    [editorModel.clips],
  );
  const generationUnitMap = useMemo(
    () => new Map(generationUnits.map((unit) => [unit.key, unit])),
    [generationUnits],
  );
  const shotMap = useMemo(
    () => new Map(editorModel.shots.map((shot) => [shot.key, shot])),
    [editorModel.shots],
  );

  useEffect(() => {
    if (!editorModel.defaultClipKey) {
      setCurrentClipKey(null);
      setSelectedShotKey(null);
      setEpisodeTime(0);
      return;
    }

    if (!currentClipKey || !clipMap.has(currentClipKey)) {
      const defaultClip = clipMap.get(editorModel.defaultClipKey) ?? null;
      setCurrentClipKey(editorModel.defaultClipKey);
      setSelectedShotKey(editorModel.defaultShotKey);
      setEpisodeTime(defaultClip?.startOffset ?? 0);
      pendingSeekRef.current = 0;
    }
  }, [clipMap, currentClipKey, editorModel.defaultClipKey, editorModel.defaultShotKey]);

  const currentClip = currentClipKey ? clipMap.get(currentClipKey) ?? null : null;
  const assetRailModel = useMemo(
    () => buildProductionAssetRailModel({
      scenes,
      currentSceneId: currentClip?.sceneId ?? null,
      dict,
      availablePaths: treePathList,
    }),
    [currentClip?.sceneId, dict, scenes, treePathList],
  );
  const currentUnit = currentClipKey ? generationUnitMap.get(currentClipKey) ?? null : null;
  const currentUnitScriptScene = currentUnit
    ? scriptSceneLookup.get(currentUnit.sceneId) ?? null
    : null;
  const currentUnitActorStateLookup = currentUnit
    ? sceneActorStateLookup.get(currentUnit.sceneId)
    : undefined;

  useEffect(() => {
    if (!currentClip) return;
    if (!selectedShotKey || currentClip.shots.every((shot) => shot.key !== selectedShotKey)) {
      setSelectedShotKey(currentClip.shots[0]?.key ?? null);
    }
  }, [currentClip, selectedShotKey]);

  const currentShot = selectedShotKey ? shotMap.get(selectedShotKey) ?? null : null;
  const selectedShot = currentShot?.clipKey === currentClipKey
    ? currentShot
    : currentClip?.shots[0] ?? null;

  const playableClipPaths = useMemo(
    () => editorModel.clips.map((clip) => clip.videoPath).filter((videoPath) => treePaths.has(videoPath)),
    [editorModel.clips, treePaths],
  );
  const mergedEpisodeVideoPath = editorModel.episodeVideoPath ?? generatedEpisodeVideoPath;
  const hasEpisodeVideo = mergedEpisodeVideoPath !== null &&
    (treePaths.has(mergedEpisodeVideoPath) || mergedEpisodeVideoPath === generatedEpisodeVideoPath);
  const currentClipExists = currentClip ? treePaths.has(currentClip.videoPath) : false;
  const previewVideoPath = hasEpisodeVideo ? mergedEpisodeVideoPath : currentClip?.videoPath ?? null;
  const previewExists = hasEpisodeVideo || currentClipExists;
  const previewPlaceholderTitle = "当前没有可播放的预览视频";
  const currentScene = currentClip ? scenes[currentClip.sceneIndex] ?? null : null;
  const storedClipData = currentClip && currentScene
    ? currentScene.clips?.[currentClip.clipIndex] ?? null
    : null;
  const currentClipData = currentClip
    ? storedClipData ?? syntheticClipData(currentClip)
    : null;
  const currentClipPath = currentClip && storedClipData
    ? `scenes.${currentClip.sceneIndex}.clips.${currentClip.clipIndex}`
    : null;
  const currentScriptPath = currentClipPath ? `${currentClipPath}.script_source` : null;
  const currentScriptSource = data && currentScriptPath && currentClipData
    ? String(getAtPath(data, currentScriptPath) ?? currentClipData.script_source ?? "")
    : currentClipData?.script_source ?? "";
  const currentSummary = currentClip && currentScene && currentClipData
    ? buildClipInspectorData(
        currentScene,
        { ...currentClipData, script_source: currentScriptSource },
        dict,
      )
    : null;
  const dictEntries = Object.entries(dict);

  useEffect(() => {
    if (!data) return;
    if (editorModel.episodeVideoPath || generatedEpisodeVideoPath) return;
    if (episodePreviewStatus !== "idle") return;
    if (playableClipPaths.length === 0) return;

    const abortController = new AbortController();
    const mergeTimer = window.setTimeout(() => {
      setEpisodePreviewStatus("building");

      fetch(`/api/projects/${encodeURIComponent(projectName)}/episode-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyboardPath: path, clipPaths: playableClipPaths }),
        signal: abortController.signal,
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || typeof payload.path !== "string") {
            throw new Error(typeof payload.error === "string" ? payload.error : `episode-preview ${response.status}`);
          }
          return payload as { path: string };
        })
        .then((payload) => {
          pendingSeekRef.current = episodeTimeRef.current;
          pendingAutoplayRef.current = playbackStatusRef.current === "playing";
          setGeneratedEpisodeVideoPath(payload.path);
          setEpisodePreviewStatus("ready");
          refresh();
        })
        .catch((err) => {
          if (abortController.signal.aborted) return;
          setEpisodePreviewStatus("error");
          console.warn("[StoryboardView] episode preview generation failed", err);
        });
    }, 500);

    return () => {
      window.clearTimeout(mergeTimer);
      abortController.abort();
    };
  }, [
    data,
    editorModel.episodeVideoPath,
    generatedEpisodeVideoPath,
    path,
    playableClipPaths,
    projectName,
    refresh,
  ]);

  const applyTimeSelection = useCallback((clip: StoryboardEditorClip, localTime: number, autoplay: boolean) => {
    const boundedLocalTime = Math.max(0, Math.min(localTime, Math.max(clip.totalDuration - 0.05, 0)));
    const nextGlobalTime = clip.startOffset + boundedLocalTime;
    const nextSelection = resolveStoryboardSelectionAtTime(editorModel, nextGlobalTime);

    setCurrentClipKey(nextSelection.clipKey ?? clip.key);
    setSelectedShotKey(nextSelection.shotKey);
    setEpisodeTime(nextGlobalTime);

    const currentVideo = videoRef.current;
    const canPlayCurrentClip = treePaths.has(clip.videoPath);
    const canPlayPreview = hasEpisodeVideo || canPlayCurrentClip;

    if (currentVideo && canPlayPreview && (hasEpisodeVideo || currentClipKey === clip.key)) {
      currentVideo.currentTime = hasEpisodeVideo ? nextGlobalTime : boundedLocalTime;
      if (autoplay) {
        void currentVideo.play().catch(() => undefined);
      }
      return;
    }

    pendingSeekRef.current = nextGlobalTime;
    pendingAutoplayRef.current = autoplay && canPlayPreview;
    if (!canPlayPreview) {
      setPlaybackStatus("idle");
    }
  }, [currentClipKey, editorModel, hasEpisodeVideo, treePaths]);

  const handleSelectClip = useCallback((clipKey: string) => {
    const clip = clipMap.get(clipKey);
    if (!clip) return;
    applyTimeSelection(clip, 0, playbackStatus === "playing");
  }, [applyTimeSelection, clipMap, playbackStatus]);

  const handleLoadedMetadata = useCallback(() => {
    const clip = currentClipKey ? clipMap.get(currentClipKey) ?? null : null;
    const video = videoRef.current;
    if (!video || (!hasEpisodeVideo && !clip)) return;

    const pendingGlobalTime = pendingSeekRef.current ?? (clip?.startOffset ?? 0);
    const boundedGlobalTime = Math.max(0, Math.min(pendingGlobalTime, Math.max(editorModel.totalDuration - 0.05, 0)));
    const boundedLocalTime = clip
      ? Math.max(0, Math.min(boundedGlobalTime - clip.startOffset, Math.max(clip.totalDuration - 0.05, 0)))
      : boundedGlobalTime;
    const targetTime = hasEpisodeVideo ? boundedGlobalTime : boundedLocalTime;
    if (Math.abs(video.currentTime - targetTime) > 0.05) {
      video.currentTime = targetTime;
    }

    const nextSelection = resolveStoryboardSelectionAtTime(editorModel, boundedGlobalTime);
    setCurrentClipKey(nextSelection.clipKey);
    setEpisodeTime(boundedGlobalTime);
    setSelectedShotKey(nextSelection.shotKey);

    const shouldAutoplay = pendingAutoplayRef.current;
    pendingSeekRef.current = null;
    pendingAutoplayRef.current = false;

    if (shouldAutoplay) {
      void video.play().catch(() => undefined);
    }
  }, [clipMap, currentClipKey, editorModel, hasEpisodeVideo]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    const clip = currentClipKey ? clipMap.get(currentClipKey) ?? null : null;
    if (!video || (!hasEpisodeVideo && !clip)) return;

    const nextGlobalTime = hasEpisodeVideo ? video.currentTime : (clip?.startOffset ?? 0) + video.currentTime;
    const nextSelection = resolveStoryboardSelectionAtTime(editorModel, nextGlobalTime);
    setEpisodeTime(nextGlobalTime);
    setCurrentClipKey((previous) => previous === nextSelection.clipKey ? previous : nextSelection.clipKey);
    setSelectedShotKey((previous) => previous === nextSelection.shotKey ? previous : nextSelection.shotKey);
  }, [clipMap, currentClipKey, editorModel, hasEpisodeVideo]);

  const handleEnded = useCallback(() => {
    if (hasEpisodeVideo) {
      const nextSelection = resolveStoryboardSelectionAtTime(editorModel, editorModel.totalDuration);
      setPlaybackStatus("idle");
      setCurrentClipKey(nextSelection.clipKey);
      setSelectedShotKey(nextSelection.shotKey);
      setEpisodeTime(editorModel.totalDuration);
      return;
    }

    if (!currentClip) return;
    const currentIndex = editorModel.clips.findIndex((clip) => clip.key === currentClip.key);
    const nextPlayableClip = editorModel.clips
      .slice(currentIndex + 1)
      .find((clip) => treePaths.has(clip.videoPath));

    if (!nextPlayableClip) {
      setPlaybackStatus("idle");
      setEpisodeTime(editorModel.totalDuration);
      return;
    }

    pendingSeekRef.current = 0;
    pendingAutoplayRef.current = true;
    setCurrentClipKey(nextPlayableClip.key);
    setSelectedShotKey(nextPlayableClip.shots[0]?.key ?? null);
    setEpisodeTime(nextPlayableClip.startOffset);
  }, [currentClip, editorModel, hasEpisodeVideo, treePaths]);

  const handlePlay = useCallback(() => {
    setPlaybackStatus("playing");
  }, []);

  const handlePause = useCallback(() => {
    const video = videoRef.current;
    setPlaybackStatus(video?.ended ? "idle" : "paused");
  }, []);

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

  if (isDraftStoryboard(data)) {
    return (
      <DraftStoryboardEditor
        data={data}
        path={path}
        projectName={projectName}
        patch={patch}
        status={status}
        savedAt={savedAt}
        error={error}
        readOnly={locked}
        onActionDone={refresh}
      />
    );
  }

  if (generationUnits.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-6 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-6 py-3 shrink-0">
          <header className="space-y-1">
            <h1 className="font-serif text-[24px] leading-tight text-[var(--color-ink)]">
              {data.title ? data.title : `${data.episode_id} 故事板`}
            </h1>
            <div className="font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)]">
              视频生成前的镜头规划与提示词定稿
            </div>
          </header>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SaveStatusLabel status={status} savedAt={savedAt} error={error} />
            <ArtifactLifecycleActions projectName={projectName} path={path} onActionDone={refresh} />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center border border-dashed border-[var(--color-rule)] bg-[var(--color-paper)] px-6 py-8 font-serif italic text-[15px] text-[var(--color-ink-faint)]">
          当前故事板里还没有可浏览的镜头。
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-6 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] px-6 py-2 shrink-0">
        <header className="space-y-1">
          <h1 className="font-serif text-[24px] leading-tight text-[var(--color-ink)]">
            {data.title ? data.title : `${data.episode_id} 故事板`}
          </h1>
          <div className="font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)]">
            视频生成前的镜头规划与提示词定稿
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SaveStatusLabel status={status} savedAt={savedAt} error={error} />
          <ArtifactLifecycleActions projectName={projectName} path={path} onActionDone={refresh} />
          <MetaBadge label="总时长" value={durationLabel(editorModel.totalDuration)} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-[var(--color-paper-sunk)] px-3 py-3 lg:px-4">
        <div className="mx-auto grid h-full w-full max-w-[1760px] grid-cols-[220px_minmax(0,1fr)] gap-3">
          <ProductionAssetRail projectName={projectName} model={assetRailModel} />
          <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 lg:gap-4">
          {currentClip && currentClipData && currentScene && currentSummary ? (
            <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2 lg:gap-3">
              <div
                className="grid min-h-0 min-w-0 gap-2 overflow-y-auto overscroll-contain lg:gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" }}
              >
                <PreviewStage
                  projectName={projectName}
                  videoPath={previewVideoPath}
                  clip={currentClip}
                  exists={previewExists}
                  placeholderTitle={previewPlaceholderTitle}
                  videoRef={videoRef}
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={handleEnded}
                  onPlay={handlePlay}
                  onPause={handlePause}
                />

                {currentUnit ? (
                  <ReviewPromptPanel
                    unit={currentUnit}
                    scriptScene={currentUnitScriptScene}
                    selectedShot={selectedShot}
                    patch={patch}
                    readOnly={locked}
                    dict={dict}
                    catalog={promptCatalog}
                    actorStateOverrides={currentUnitActorStateLookup}
                    stateNameById={stateNameById}
                  />
                ) : (
                  <ClipInfoPanel
                    summary={currentSummary}
                    source={currentScriptSource}
                    selectedShot={selectedShot}
                    dict={dict}
                    className="min-h-0 overflow-y-auto overscroll-contain"
                  >
                    {dictEntries.length > 0 && (
                      <details className="border-t border-[var(--color-rule)] pt-3">
                        <summary className="cursor-pointer select-none font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]">
                          展开参考表（{dictEntries.length} 项）
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-[Geist,sans-serif] text-[11px] text-[var(--color-ink-subtle)]">
                          {dictEntries.map(([id, name]) => (
                            <span key={id}>
                              <span className="font-mono text-[var(--color-ink-faint)]">{`{${id}}`}</span>
                              <span className="ml-1">{name}</span>
                            </span>
                          ))}
                        </div>
                      </details>
                    )}

                    <ShotList shots={(currentClipData.shots as ShotRef[] | undefined) ?? []} dict={dict} />

                    {(currentClipData.complete_prompt || currentClipData.complete_prompt_v2) && (
                      <details className="border-t border-[var(--color-rule)] pt-3">
                        <summary className="cursor-pointer select-none font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]">
                          展开完整合成提示词 complete_prompt
                        </summary>
                        <div className="mt-2 space-y-2">
                          {currentClipData.complete_prompt && (
                            <pre className="whitespace-pre-wrap break-words font-[Geist,sans-serif] text-[12px] italic text-[var(--color-ink-muted)]">
                              {resolveRefs(currentClipData.complete_prompt, dict)}
                            </pre>
                          )}
                          {currentClipData.complete_prompt_v2 && (
                            <pre className="whitespace-pre-wrap break-words font-[Geist,sans-serif] text-[12px] italic text-[var(--color-ink-muted)]">
                              {resolveRefs(currentClipData.complete_prompt_v2, dict)}
                            </pre>
                          )}
                        </div>
                      </details>
                    )}

                    {currentClipPath && (
                      <EditableClipFields
                        clip={currentClipData}
                        clipPath={currentClipPath}
                        data={data}
                        patch={patch}
                        status={status}
                        readOnly={locked}
                      />
                    )}
                  </ClipInfoPanel>
                )}
              </div>

              <SegmentTimeline
                projectName={projectName}
                clips={editorModel.clips}
                currentClipKey={currentClip.key}
                availablePaths={treePaths}
                episodeTime={episodeTime}
                totalDuration={editorModel.totalDuration}
                onSelectClip={handleSelectClip}
              />
            </section>
          ) : (
            <StoryboardGenerationUnitList
              units={generationUnits}
              sceneLookup={scriptSceneLookup}
              patch={patch}
              readOnly={locked}
              dict={dict}
              catalog={promptCatalog}
              sceneActorStateLookup={sceneActorStateLookup}
              stateNameById={stateNameById}
            />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
