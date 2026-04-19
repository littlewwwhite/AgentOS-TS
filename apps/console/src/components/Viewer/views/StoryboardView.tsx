// input: projectName + relPath → storyboard JSON (ep*_storyboard.json)
//        + output/script.json and draft/catalog.json for placeholder dictionaries
// output: storyboard deck with text track and generated video track aligned per clip
// pos: StoryboardView panel inside the Viewer

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useEditableJson, getAtPath } from "../../../hooks/useEditableJson";
import { useFileJson } from "../../../hooks/useFile";
import { useProject } from "../../../contexts/ProjectContext";
import { buildRefDict, resolveRefs, type ScriptJson } from "../../../lib/fountain";
import { fileUrl } from "../../../lib/fileUrl";
import {
  buildClipInspectorData,
  clipVideoPath,
  shotDuration,
  splitStoryboardText,
  type StoryboardEditorClip,
  type StoryboardEditorShot,
  type ClipInspectorData,
  buildStoryboardEditorModel,
  type StoryboardClipLike,
  type StoryboardSceneLike,
  type StoryboardShotLike,
} from "../../../lib/storyboard";
import { EditableText } from "../../common/EditableText";
import { SaveStatusDot } from "../../common/SaveStatusDot";

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
}

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
    <div className="font-[Geist,sans-serif] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-subtle)] mb-1">
      {children}
    </div>
  );
}

function TrackLabel({ children }: { children: string }) {
  return (
    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-subtle)] mb-2">
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
    <span className="inline-flex items-center gap-2 border border-[var(--color-rule)] bg-[var(--color-paper)] px-2.5 py-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
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
      <div className="font-[Geist,sans-serif] text-[12px] leading-relaxed text-[var(--color-ink-muted)] whitespace-pre-wrap break-words">
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

function PreviewStage({
  projectName,
  videoPath,
  exists,
  clipId,
  sceneId,
}: {
  projectName: string;
  videoPath: string;
  exists: boolean;
  clipId: string;
  sceneId: string;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <TrackLabel>剪影预览</TrackLabel>
        <span
          className={
            "font-mono text-[10px] uppercase tracking-wider " +
            (exists ? "text-[var(--color-ok)]" : "text-[var(--color-warn)]")
          }
        >
          {exists ? "已生成" : "待生成"}
        </span>
      </div>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden border border-[var(--color-rule)] bg-[var(--color-ink)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.48)_100%)]" />
        {exists ? (
          <video
            controls
            preload="metadata"
            src={fileUrl(projectName, videoPath)}
            className="relative z-10 h-full w-full min-w-0 object-contain bg-black"
          />
        ) : (
          <div className="relative z-10 flex h-full items-center justify-center px-6 text-center">
            <div className="space-y-3">
              <div className="font-serif text-[20px] italic text-white/90">
                这里展示 clip 预览舞台
              </div>
              <div className="font-[Geist,sans-serif] text-[13px] leading-relaxed text-white/70">
                当前还没有匹配到生成视频，但音轨与脚本信息仍可在右侧继续校对。
              </div>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute left-4 top-4 z-20 flex flex-wrap gap-2">
          <span className="border border-white/15 bg-black/35 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-white/85">
            {sceneId}
          </span>
          <span className="border border-white/15 bg-black/35 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-white/85">
            {clipId}
          </span>
        </div>
      </div>

      <div className="font-mono text-[10px] text-[var(--color-ink-faint)] break-all">
        {videoPath}
      </div>
    </div>
  );
}

function TimelineClipButton({
  clip,
  selected,
  onSelect,
}: {
  clip: StoryboardEditorClip;
  selected: boolean;
  onSelect: (clipKey: string) => void;
}) {
  const basisDuration = Math.max(clip.totalDuration, 1);

  return (
    <button
      type="button"
      onClick={() => onSelect(clip.key)}
      className={
        "group flex min-w-[120px] flex-col justify-between border-r border-[var(--color-rule)] px-3 py-2 text-left last:border-r-0 " +
        (selected ? "bg-[var(--color-accent-soft)]" : "bg-transparent hover:bg-[var(--color-paper)]")
      }
      style={{ flexGrow: basisDuration, flexBasis: `${Math.max(12, basisDuration * 10)}%` }}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-accent)]">
          {clip.sceneId}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
          {clip.clipId}
        </span>
      </div>
      <div className="mt-2 line-clamp-2 font-[Geist,sans-serif] text-[12px] leading-snug text-[var(--color-ink-muted)]">
        {clip.displayText || "（无剧本原文）"}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 font-mono text-[10px] text-[var(--color-ink-faint)]">
        <span>{clip.shotCount} 镜</span>
        <span>{durationLabel(clip.totalDuration || 1)}</span>
      </div>
    </button>
  );
}

function TimelineShotButton({
  shot,
  selected,
  onSelect,
}: {
  shot: StoryboardEditorShot;
  selected: boolean;
  onSelect: (shotKey: string) => void;
}) {
  const waveformBars = Math.max(3, Math.min(9, Math.round(Math.max(shot.duration, 1) * 2)));

  return (
    <button
      type="button"
      onClick={() => onSelect(shot.key)}
      className={
        "group flex min-w-[96px] flex-col gap-2 border-r border-[var(--color-rule)] px-3 py-2 text-left last:border-r-0 " +
        (selected ? "bg-[var(--color-accent-soft)]" : "bg-transparent hover:bg-[var(--color-paper)]")
      }
      style={{ flexGrow: Math.max(shot.duration, 1), flexBasis: `${Math.max(10, shot.duration * 16)}%` }}
      title={shot.prompt}
    >
      <div className="flex h-10 items-end gap-1">
        {Array.from({ length: waveformBars }).map((_, barIndex) => {
          const barHeight =
            22 + (((barIndex + 1) * 17 + Math.round(shot.duration * 11)) % 56);
          return (
            <span
              key={`${shot.key}-${barIndex}`}
              className="w-1 rounded-full bg-[var(--color-accent)] opacity-80"
              style={{ height: `${barHeight}%` }}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-[var(--color-ink-subtle)]">
        <span className="text-[var(--color-accent)]">{shot.shotId}</span>
        <span>{shot.timeRange ?? durationLabel(shot.duration)}</span>
      </div>
    </button>
  );
}

function EditorTimeline({
  selectedClip,
  hasPlayableMedia,
  clips,
  selectedClipKey,
  onSelectClip,
  selectedShotKey,
  onSelectShot,
  summary,
}: {
  selectedClip: StoryboardEditorClip;
  hasPlayableMedia: boolean;
  clips: StoryboardEditorClip[];
  selectedClipKey: string;
  onSelectClip: (clipKey: string) => void;
  selectedShotKey: string | null;
  onSelectShot: (shotKey: string) => void;
  summary: ClipInspectorData;
}) {
  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_1fr] gap-3 border border-[var(--color-rule)] bg-[var(--color-paper)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TrackLabel>时间轴</TrackLabel>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-subtle)]">
            当前片段 {selectedClip.clipId}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
            {selectedClip.shotCount} 镜 · {durationLabel(selectedClip.totalDuration || 1)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
            {hasPlayableMedia ? "media linked" : "media pending"}
          </span>
        </div>
      </div>

      <div className="grid min-h-0 grid-rows-[minmax(58px,0.8fr)_minmax(96px,1.2fr)] gap-3">
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
            片段轨
          </div>
          <div className="flex overflow-x-auto border border-[var(--color-rule)] bg-[var(--color-paper-sunk)]">
            {clips.map((clip) => (
              <TimelineClipButton
                key={clip.key}
                clip={clip}
                selected={clip.key === selectedClipKey}
                onSelect={onSelectClip}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2 min-h-0">
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
              音轨 / 镜头轨
            </div>
            <div className="font-[Geist,sans-serif] text-[12px] text-[var(--color-ink-muted)]">
              {hasPlayableMedia
                ? "点击镜头条切换查看；音频沿用当前 clip 的真实音轨"
                : summary.sfxPrompt || "点击镜头条切换查看当前分镜"}
            </div>
          </div>
          <div className="flex min-h-[108px] overflow-x-auto border border-[var(--color-rule)] bg-[var(--color-paper-sunk)]">
            {selectedClip.shots.map((shot) => (
              <TimelineShotButton
                key={shot.key}
                shot={shot}
                selected={shot.key === selectedShotKey}
                onSelect={onSelectShot}
              />
            ))}
          </div>
        </div>
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
    <aside className={`min-w-0 bg-[var(--color-paper)] border border-[var(--color-rule)] px-5 py-4 space-y-4 ${className}`.trim()}>
      <div className="flex flex-wrap gap-2">
        {summary.environment && <MetaBadge label="场域" value={summary.environment} />}
        {summary.location && <MetaBadge label="场景" value={summary.location} />}
        {summary.expectedDuration && <MetaBadge label="时长" value={summary.expectedDuration} />}
        <MetaBadge label="镜头" value={`${summary.shotCount}`} />
        <MetaBadge
          label="节奏"
          value={`${summary.totalDuration.toFixed(summary.totalDuration % 1 === 0 ? 0 : 1)}s`}
        />
      </div>

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

      {selectedShot && (
        <InfoPanelSection title="当前镜头">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <MetaBadge label="镜头" value={selectedShot.shotId} />
              <MetaBadge label="时段" value={selectedShot.timeRange ?? durationLabel(selectedShot.duration)} />
            </div>
            <div>{selectedShot.prompt || "（无镜头提示词）"}</div>
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
              <li key={`${index}-${beat}`} className="grid grid-cols-[28px_1fr] gap-3">
                <span className="font-mono text-[10px] text-[var(--color-ink-faint)] pt-0.5">
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
      <summary className="font-mono text-[11px] text-[var(--color-ink-subtle)] cursor-pointer select-none hover:text-[var(--color-ink)] transition-colors">
        展开镜头轨明细（{shots.length} 镜）
      </summary>
      <div className="mt-3 space-y-3">
        {shots.map((shot, index) => (
          <div
            key={shot.shot_id ?? index}
            className="grid grid-cols-[72px_1fr] gap-3 border-l-2 border-[var(--color-accent)] pl-3"
          >
            <div>
              <div className="font-mono text-[11px] text-[var(--color-accent)] uppercase tracking-wider">
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
}: {
  clip: ClipRef;
  clipPath: string;
  data: StoryboardJson;
  patch: (path: string, value: unknown) => void;
  status: "idle" | "loading" | "saving" | "saved" | "error";
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
      <summary className="font-mono text-[11px] text-[var(--color-ink-subtle)] cursor-pointer select-none hover:text-[var(--color-ink)] transition-colors">
        原始字段 / 可编辑
      </summary>
      <div className="mt-3 space-y-4">
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
        </div>
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
      </div>
    </details>
  );
}

function scriptPathFor(storyboardPath: string): string {
  if (storyboardPath.startsWith("output/")) return "output/script.json";
  return storyboardPath.replace(/(?:^|\/)[^/]+_storyboard\.json$/, "script.json");
}

export function StoryboardView({ projectName, path }: { projectName: string; path: string }) {
  const { tree } = useProject();
  const { data, error, status, patch, savedAt } =
    useEditableJson<StoryboardJson>(projectName, path);

  const { data: scriptData } = useFileJson<ScriptJson>(projectName, scriptPathFor(path));
  const { data: catalogData } = useFileJson<ScriptJson>(projectName, "draft/catalog.json");

  const dict = useMemo(
    () => ({
      ...buildRefDict(catalogData ?? {}),
      ...buildRefDict(scriptData ?? {}),
    }),
    [catalogData, scriptData],
  );
  const treePaths = useMemo(() => new Set(tree.map((node) => node.path)), [tree]);
  const editorModel = useMemo(
    () => buildStoryboardEditorModel(path, data?.scenes ?? [], dict),
    [data?.scenes, dict, path],
  );

  const [selectedClipKey, setSelectedClipKey] = useState<string | null>(editorModel.defaultClipKey);
  const [selectedShotKey, setSelectedShotKey] = useState<string | null>(null);

  useEffect(() => {
    if (!editorModel.defaultClipKey) {
      setSelectedClipKey(null);
      setSelectedShotKey(null);
      return;
    }
    if (!selectedClipKey || !editorModel.clips.some((clip) => clip.key === selectedClipKey)) {
      setSelectedClipKey(editorModel.defaultClipKey);
    }
  }, [editorModel, selectedClipKey]);

  const scenes = data?.scenes ?? [];
  const selectedClip = editorModel.clips.find((clip) => clip.key === selectedClipKey) ?? null;

  useEffect(() => {
    if (!selectedClip) {
      setSelectedShotKey(null);
      return;
    }
    if (!selectedShotKey || !selectedClip.shots.some((shot) => shot.key === selectedShotKey)) {
      setSelectedShotKey(selectedClip.shots[0]?.key ?? null);
    }
  }, [selectedClip, selectedShotKey]);

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

  const totalClips = scenes.reduce((acc, sc) => acc + (sc.clips?.length ?? 0), 0);
  const totalShots = scenes.reduce(
    (acc, sc) => acc + (sc.clips ?? []).reduce((clipAcc, cl) => clipAcc + (cl.shots?.length ?? 0), 0),
    0,
  );
  const dictEntries = Object.entries(dict);
  const selectedShot =
    selectedClip?.shots.find((shot) => shot.key === selectedShotKey) ?? selectedClip?.shots[0] ?? null;
  const selectedScene = selectedClip ? scenes[selectedClip.sceneIndex] ?? null : null;
  const selectedClipData = selectedClip && selectedScene
    ? selectedScene.clips?.[selectedClip.clipIndex] ?? null
    : null;
  const selectedClipPath = selectedClip
    ? `scenes.${selectedClip.sceneIndex}.clips.${selectedClip.clipIndex}`
    : null;
  const selectedScriptPath = selectedClipPath ? `${selectedClipPath}.script_source` : null;
  const selectedScriptSource = selectedScriptPath && selectedClipData
    ? String(getAtPath(data, selectedScriptPath) ?? selectedClipData.script_source ?? "")
    : "";
  const selectedSummary = selectedClipData && selectedScene
    ? buildClipInspectorData(
        selectedScene,
        { ...selectedClipData, script_source: selectedScriptSource },
        dict,
      )
    : null;
  const selectedVideoExists = selectedClip ? treePaths.has(selectedClip.videoPath) : false;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-6 px-6 py-3 border-b border-[var(--color-rule)] bg-[var(--color-paper-soft)] shrink-0">
        <header className="space-y-1">
          <h1 className="font-serif text-[28px] leading-tight text-[var(--color-ink)]">
            {data.title ? data.title : `${data.episode_id} 分镜脚本`}
          </h1>
          <div className="font-mono text-[11px] text-[var(--color-ink-subtle)]">
            固定舞台模式 · 点击底部时间轴查看片段 / 镜头
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SaveStatusLabel status={status} savedAt={savedAt} error={error} />
          <MetaBadge label="场次" value={`${scenes.length}`} />
          <MetaBadge label="片段" value={`${totalClips}`} />
          <MetaBadge label="镜头" value={`${totalShots}`} />
        </div>
      </div>

      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
        {!selectedClip || !selectedClipData || !selectedScene || !selectedSummary || !selectedClipPath ? (
          <div className="flex h-full items-center justify-center border border-dashed border-[var(--color-rule)] bg-[var(--color-paper)] px-6 py-8 font-serif italic text-[15px] text-[var(--color-ink-faint)]">
            当前分镜文件里还没有可编辑的 clip。
          </div>
        ) : (
          <div className="grid flex-1 min-h-0 grid-rows-[minmax(0,1fr)_240px] gap-4">
            <div
              className="grid min-h-0 gap-4 overflow-hidden"
              style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 360px)" }}
            >
              <PreviewStage
                projectName={projectName}
                videoPath={selectedClip.videoPath}
                exists={selectedVideoExists}
                clipId={selectedClip.clipId}
                sceneId={selectedClip.sceneId}
              />

              <ClipInfoPanel
                summary={selectedSummary}
                source={selectedScriptSource}
                selectedShot={selectedShot}
                dict={dict}
                className="h-full min-h-0 overflow-y-auto overscroll-contain"
              >
                {dictEntries.length > 0 && (
                  <details className="border-t border-[var(--color-rule)] pt-3">
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

                <ShotList shots={(selectedClipData.shots as ShotRef[] | undefined) ?? []} dict={dict} />

                {(selectedClipData.complete_prompt || selectedClipData.complete_prompt_v2) && (
                  <details className="border-t border-[var(--color-rule)] pt-3">
                    <summary className="font-mono text-[11px] text-[var(--color-ink-subtle)] cursor-pointer select-none hover:text-[var(--color-ink)] transition-colors">
                      展开完整合成提示词 complete_prompt
                    </summary>
                    <div className="mt-2 space-y-2">
                      {selectedClipData.complete_prompt && (
                        <pre className="font-[Geist,sans-serif] text-[12px] italic text-[var(--color-ink-muted)] whitespace-pre-wrap break-words">
                          {resolveRefs(selectedClipData.complete_prompt, dict)}
                        </pre>
                      )}
                      {selectedClipData.complete_prompt_v2 && (
                        <pre className="font-[Geist,sans-serif] text-[12px] italic text-[var(--color-ink-muted)] whitespace-pre-wrap break-words">
                          {resolveRefs(selectedClipData.complete_prompt_v2, dict)}
                        </pre>
                      )}
                    </div>
                  </details>
                )}

                <EditableClipFields
                  clip={selectedClipData}
                  clipPath={selectedClipPath}
                  data={data}
                  patch={patch}
                  status={status}
                />
              </ClipInfoPanel>
            </div>

            <EditorTimeline
              selectedClip={selectedClip}
              hasPlayableMedia={selectedVideoExists}
              clips={editorModel.clips}
              selectedClipKey={selectedClip.key}
              onSelectClip={setSelectedClipKey}
              selectedShotKey={selectedShot?.key ?? null}
              onSelectShot={setSelectedShotKey}
              summary={selectedSummary}
            />
          </div>
        )}
      </div>
    </div>
  );
}
