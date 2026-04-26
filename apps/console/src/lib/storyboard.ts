// input: storyboard JSON fragments, project paths, and optional reference dictionaries
// output: editor timelines, prompt summaries, media paths, and selection helpers
// pos: shared domain helpers behind rendered storyboard editing and playback

import {
  buildFountainTokens,
  buildRefDict,
  resolveRefs,
  type FountainToken,
  type ScriptJson,
} from "./fountain";
import { episodeIdFromStoryboardPath, episodeRuntimeDirForStoryboardPath } from "./storyboardPaths";

export interface StoryboardShotLike {
  shot_id?: string;
  time_range?: string;
  duration?: number;
  partial_prompt?: string;
  partial_prompt_v2?: string;
  shot_type?: string;
  camera_movement?: string;
  is_overlap?: boolean;
  is_bridge?: boolean;
  source_refs?: unknown;
  prompt?: string;
}

export interface StoryboardSceneLike {
  scene_id?: string;
  environment?: { space?: string; time?: string };
  locations?: Array<{ location_id: string; state_id?: string | null }>;
  actors?: Array<{ actor_id: string; state_id?: string | null }>;
  props?: Array<{ prop_id: string; state_id?: string | null }>;
}

export interface StoryboardClipLike {
  expected_duration?: string;
  script_source?: string;
  layout_prompt?: string;
  sfx_prompt?: string;
  complete_prompt?: string;
  complete_prompt_v2?: string;
  shots?: ReadonlyArray<StoryboardShotLike>;
}

export interface ClipInspectorData {
  location: string | null;
  environment: string | null;
  characters: string[];
  props: string[];
  scriptSource: string;
  layoutPrompt: string;
  sfxPrompt: string;
  promptPreview: string;
  shotCount: number;
  totalDuration: number;
  expectedDuration: string | null;
}

export interface StoryboardEditorShot {
  key: string;
  clipKey: string;
  sceneId: string;
  clipId: string;
  shotId: string;
  timeRange: string | null;
  duration: number;
  localStartOffset: number;
  localEndOffset: number;
  startOffset: number;
  endOffset: number;
  prompt: string;
}

export interface StoryboardEditorClip {
  key: string;
  sceneId: string;
  sceneIndex: number;
  clipId: string;
  clipIndex: number;
  videoPath: string;
  expectedDuration: string | null;
  totalDuration: number;
  startOffset: number;
  endOffset: number;
  shotCount: number;
  displayText: string;
  shots: StoryboardEditorShot[];
}

export interface StoryboardEditorModel {
  clips: StoryboardEditorClip[];
  shots: StoryboardEditorShot[];
  defaultClipKey: string | null;
  defaultShotKey: string | null;
  totalDuration: number;
  episodeVideoPath: string | null;
}

export interface StoryboardGenerationUnitShot {
  shotId: string;
  timeRange: string | null;
  duration: number;
  prompt: string;
}

export interface StoryboardGenerationUnit {
  key: string;
  episodeId: string;
  sceneId: string;
  partId: string;
  sourceRefsLabel: string;
  scriptExcerpt: string[];
  prompt: string;
  promptSummary: string;
  shots: StoryboardGenerationUnitShot[];
  videoPath: string;
  videoStatus: "generated" | "not_generated";
}

export interface DraftStoryboardShotSummary {
  shotId: string;
  timeRange: string | null;
  cameraType: string | null;
}

export interface DraftStoryboardPromptSummary {
  partLabel: string;
  summary: string | null;
  shots: DraftStoryboardShotSummary[];
}

function uniqueNames(names: Array<string | null | undefined>): string[] {
  return Array.from(new Set(names.filter((value): value is string => Boolean(value && value.trim()))));
}

function resolveName(id: string | null | undefined, dict: Record<string, string>): string | null {
  if (!id) return null;
  return dict[id] ?? id;
}

function stripActionPrefix(text: string): string {
  return text.replace(/^(?:action|动作)\s*[：:]\s*/i, "").trim();
}

function numericDuration(text: string | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function spaceCode(space: string | undefined): string | null {
  if (!space) return null;
  if (space === "interior") return "INT";
  if (space === "exterior") return "EXT";
  return space.toUpperCase();
}

function compactStoryboardId(id: string): string {
  return id.trim().replace(/_/g, "");
}

function basenameOf(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function dirnameOf(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isVideoPath(path: string): boolean {
  return /\.(?:mp4|mov|webm)$/i.test(path);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function coerceString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function extractStoryboardShotsObject(text: string): { shots?: unknown[] } | null {
  const starts = Array.from(text.matchAll(/\{\s*"shots"\s*:/g), (match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .reverse();

  for (const start of starts) {
    let end = text.lastIndexOf("}");
    while (end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as { shots?: unknown }).shots)) {
          return parsed as { shots?: unknown[] };
        }
      } catch {
        // Try the previous closing brace; draft prompts often contain prose before JSON.
      }
      end = text.lastIndexOf("}", end - 1);
    }
  }

  return null;
}

function extractDraftSummary(text: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const index = lines.findIndex((line) => line.startsWith("剧情摘要"));
  if (index < 0) return null;
  const current = lines[index];
  if (/^剧情摘要\s*[：:]\s*\S/.test(current)) return current;
  const next = lines.slice(index + 1).find(Boolean);
  return next ? `剧情摘要：${next}` : current;
}

export function summarizeSourceRefs(refs: unknown): string {
  if (!isNumberArray(refs) || refs.length === 0) return "无";
  const sorted = [...refs].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (const current of sorted.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }

  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
  return ranges.join(", ");
}

export function parseDraftStoryboardPrompt(prompt: string): DraftStoryboardPromptSummary {
  const partLabel = prompt.split(/\r?\n/, 1)[0]?.trim() || "PART";
  const parsed = extractStoryboardShotsObject(prompt);
  const shots = (parsed?.shots ?? [])
    .filter((shot): shot is Record<string, unknown> => !!shot && typeof shot === "object" && !Array.isArray(shot))
    .map((shot, index) => {
      const cameraSetup = shot.camera_setup;
      const cameraType =
        cameraSetup && typeof cameraSetup === "object" && !Array.isArray(cameraSetup)
          ? coerceString((cameraSetup as Record<string, unknown>).type)
          : null;

      return {
        shotId: coerceString(shot.shot_id) ?? `S${index + 1}`,
        timeRange: coerceString(shot.time_range),
        cameraType,
      };
    });

  return {
    partLabel,
    summary: extractDraftSummary(prompt),
    shots,
  };
}

function episodeSlugFromPath(storyboardPath: string): string {
  const episodeId = episodeIdFromStoryboardPath(storyboardPath);
  return episodeId ? compactStoryboardId(episodeId) : "ep";
}

export function clipVideoPath(
  storyboardPath: string,
  sceneId: string,
  clipId: string,
): string {
  const episodeDir = episodeRuntimeDirForStoryboardPath(storyboardPath);
  const episodeSlug = episodeSlugFromPath(storyboardPath);
  const sceneSlug = compactStoryboardId(sceneId);
  const clipSlug = compactStoryboardId(clipId);
  return `${episodeDir}/${sceneSlug}/${episodeSlug}_${sceneSlug}_${clipSlug}.mp4`;
}

function resolveEpisodeVideoPath(
  storyboardPath: string,
  availablePaths?: ReadonlyArray<string>,
): string | null {
  if (!availablePaths || availablePaths.length === 0) return null;

  const episodeDir = episodeRuntimeDirForStoryboardPath(storyboardPath);
  const episodeSlug = episodeSlugFromPath(storyboardPath);
  const exactBasename = `${episodeSlug}.mp4`;
  const exactCandidate = episodeDir ? `${episodeDir}/${exactBasename}` : exactBasename;

  if (availablePaths.includes(exactCandidate)) return exactCandidate;

  return availablePaths.find((path) => dirnameOf(path) === episodeDir && basenameOf(path) === exactBasename) ?? null;
}

function resolveClipVideoPath(
  storyboardPath: string,
  sceneId: string,
  clipId: string,
  availablePaths?: ReadonlyArray<string>,
): string {
  const fallbackPath = clipVideoPath(storyboardPath, sceneId, clipId);
  if (!availablePaths || availablePaths.length === 0) return fallbackPath;

  const episodeDir = episodeRuntimeDirForStoryboardPath(storyboardPath);
  const episodeSlug = episodeSlugFromPath(storyboardPath);
  const sceneSlug = compactStoryboardId(sceneId);
  const clipSlug = compactStoryboardId(clipId);
  const fileStem = `${episodeSlug}_${sceneSlug}_${clipSlug}`;

  const preferredCandidates = [
    `${episodeDir}/${sceneSlug}/${clipSlug}/${fileStem}.mp4`,
    `${episodeDir}/${sceneSlug}/${fileStem}.mp4`,
    fallbackPath,
  ];

  for (const candidate of preferredCandidates) {
    if (availablePaths.includes(candidate)) return candidate;
  }

  const variantPattern = new RegExp(`^${escapeRegExp(fileStem)}(?:_(\\d+))?$`, "i");
  const scopedMatches = availablePaths
    .filter((path) => path.startsWith(`${episodeDir}/`))
    .filter((path) => variantPattern.test(stripExtension(basenameOf(path))))
    .sort((left, right) => {
      const leftName = stripExtension(basenameOf(left));
      const rightName = stripExtension(basenameOf(right));
      const leftMatch = leftName.match(variantPattern);
      const rightMatch = rightName.match(variantPattern);
      const leftVariant = leftMatch?.[1] ? Number(leftMatch[1]) : 0;
      const rightVariant = rightMatch?.[1] ? Number(rightMatch[1]) : 0;
      if (leftVariant !== rightVariant) return leftVariant - rightVariant;
      if (left.length !== right.length) return left.length - right.length;
      return left.localeCompare(right);
    });

  return scopedMatches[0] ?? fallbackPath;
}

function secondsFromTimeMark(value: string): number | null {
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function durationFromRange(range: string | undefined): number | null {
  if (!range) return null;
  const match = range.match(/(\d+(?::\d+(?:\.\d+)?|\.\d+)?)\s*[-–—]\s*(\d+(?::\d+(?:\.\d+)?|\.\d+)?)/);
  if (!match) return null;
  const start = secondsFromTimeMark(match[1]);
  const end = secondsFromTimeMark(match[2]);
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
}

export function shotDuration(shot: StoryboardShotLike): number {
  if (typeof shot.duration === "number" && Number.isFinite(shot.duration) && shot.duration > 0) {
    return shot.duration;
  }
  return durationFromRange(shot.time_range) ?? 1;
}

function cameraSetupText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return coerceString((value as Record<string, unknown>).type);
}

function shotBeatsText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean)
    .join("\n") || null;
}

function storyboardPromptShotText(shot: Record<string, unknown>): string {
  return [
    cameraSetupText(shot.camera_setup),
    shotBeatsText(shot.beats),
  ].filter(Boolean).join("\n");
}

function storyboardShotsFromPrompt(prompt: string): StoryboardShotLike[] {
  const parsed = extractStoryboardShotsObject(prompt);
  return (parsed?.shots ?? [])
    .filter((shot): shot is Record<string, unknown> => !!shot && typeof shot === "object" && !Array.isArray(shot))
    .map((shot, index) => ({
      shot_id: coerceString(shot.shot_id) ?? `S${index + 1}`,
      time_range: coerceString(shot.time_range) ?? undefined,
      partial_prompt: storyboardPromptShotText(shot),
    }));
}

function storyboardPromptSummary(prompt: string): string {
  const lines = prompt.split(/\r?\n/).map((line) => line.trim());
  const fenceIndex = lines.findIndex((line) => line.startsWith("```") || line.startsWith("{"));
  const proseLines = (fenceIndex >= 0 ? lines.slice(1, fenceIndex) : lines.slice(1)).filter(Boolean);
  return proseLines[0] ?? "";
}

function scenePromptClips(
  scene: StoryboardSceneLike & {
    scene_id: string;
    shots?: ReadonlyArray<StoryboardShotLike>;
  },
): Array<StoryboardClipLike & { clip_id: string; shots?: ReadonlyArray<StoryboardShotLike> }> {
  return (scene.shots ?? [])
    .filter((shot) => typeof shot.prompt === "string" && shot.prompt.trim())
    .map((shot, index) => ({
      clip_id: `part_${String(index + 1).padStart(3, "0")}`,
      script_source: storyboardPromptSummary(shot.prompt ?? ""),
      shots: storyboardShotsFromPrompt(shot.prompt ?? ""),
    }));
}

function sceneTokenKey(epIndex: number, sceneIndex: number): string {
  return `${epIndex}:${sceneIndex}`;
}

type SceneActionToken = Extract<FountainToken, {
  kind: "action" | "character" | "dialogue";
}>;

function actionTokenKey(token: SceneActionToken): string {
  return `${token.epIndex}:${token.sceneIndex}:${token.actionIndex}`;
}

function sourceRefsFromValue(value: unknown): number[] {
  return isNumberArray(value) ? [...value] : [];
}

type SceneBeatIndexEntry = {
  episodeId: string;
  beats: string[];
};

function buildSceneBeatIndex(script: ScriptJson | null | undefined): Map<string, SceneBeatIndexEntry> {
  if (!script) return new Map();
  const dict = buildRefDict(script);
  const tokens = buildFountainTokens(script);
  const episodeIds = new Map<number, string>();
  const scenes = new Map<string, { episodeId: string | null; sceneId: string; beats: string[] }>();
  const speakers = new Map<string, string>();

  for (const token of tokens) {
    if (token.kind === "episode") {
      episodeIds.set(token.epIndex, token.episodeId);
      continue;
    }

    if (token.kind === "scene_heading") {
      scenes.set(sceneTokenKey(token.epIndex, token.sceneIndex), {
        episodeId: episodeIds.get(token.epIndex) ?? "",
        sceneId: token.sceneId,
        beats: [],
      });
      continue;
    }

    if (token.kind === "character") {
      speakers.set(actionTokenKey(token), token.name);
      continue;
    }

    const scene = scenes.get(sceneTokenKey(token.epIndex, token.sceneIndex));
    if (!scene) continue;

    if (token.kind === "action") {
      const text = resolveRefs(token.text, dict).trim();
      if (text) scene.beats.push(text);
      continue;
    }

    if (token.kind === "dialogue") {
      const text = resolveRefs(token.text, dict).trim();
      if (!text) continue;
      const speaker = speakers.get(actionTokenKey(token)) ?? dict[token.actorId] ?? token.actorId;
      scene.beats.push(`${speaker}：${text}`);
    }
  }

  return new Map(
    Array.from(scenes.values()).map((scene) => [
      `${scene.episodeId}::${scene.sceneId}`,
      { episodeId: scene.episodeId, beats: scene.beats },
    ]),
  );
}

function sceneBeatEntry(
  sceneBeats: Map<string, SceneBeatIndexEntry>,
  episodeId: string,
  sceneId: string,
): SceneBeatIndexEntry | null {
  return (
    sceneBeats.get(`${episodeId}::${sceneId}`) ??
    Array.from(sceneBeats.entries())
      .find(([key]) => key.endsWith(`::${sceneId}`))
      ?.[1] ??
    null
  );
}

function sceneExcerptFromRefs(
  sceneBeats: Map<string, SceneBeatIndexEntry>,
  episodeId: string,
  sceneId: string,
  refs: number[],
): string[] {
  const entry = sceneBeatEntry(sceneBeats, episodeId, sceneId);
  if (!entry) return ["未找到对应剧本段落"];
  const lines = refs.length > 0
    ? refs.map((index) => entry.beats[index]).filter((beat): beat is string => Boolean(beat && beat.trim()))
    : entry.beats.filter((beat): beat is string => Boolean(beat && beat.trim()));
  return lines.length > 0 ? lines : ["未找到对应剧本段落"];
}

function generationPromptSummary(prompt: string): string {
  return parseDraftStoryboardPrompt(prompt).summary ?? storyboardPromptSummary(prompt);
}

export function buildStoryboardGenerationUnits(
  storyboardPath: string,
  scenes: ReadonlyArray<StoryboardSceneLike & {
    scene_id: string;
    shots?: ReadonlyArray<StoryboardShotLike>;
  }>,
  script: ScriptJson | null | undefined,
  availablePaths?: Iterable<string>,
): StoryboardGenerationUnit[] {
  const episodeId = episodeIdFromStoryboardPath(storyboardPath) ?? "";
  const mediaPaths = availablePaths
    ? Array.from(new Set(Array.from(availablePaths).filter(isVideoPath)))
    : undefined;
  const sceneBeats = buildSceneBeatIndex(script);

  return scenes.flatMap((scene) =>
    (scene.shots ?? [])
      .filter((shot) => typeof shot.prompt === "string" && shot.prompt.trim())
      .map((shot, index) => {
        const partId = `part_${String(index + 1).padStart(3, "0")}`;
        const videoPath = resolveClipVideoPath(storyboardPath, scene.scene_id, partId, mediaPaths);
        const sourceRefs = sourceRefsFromValue(shot.source_refs);
        const prompt = shot.prompt?.trim() ?? "";

        return {
          key: `${scene.scene_id}::${partId}`,
          episodeId,
          sceneId: scene.scene_id,
          partId,
          sourceRefsLabel: summarizeSourceRefs(sourceRefs),
          scriptExcerpt: sceneExcerptFromRefs(sceneBeats, episodeId, scene.scene_id, sourceRefs),
          prompt,
          promptSummary: generationPromptSummary(prompt),
          shots: storyboardShotsFromPrompt(prompt).map((promptShot) => ({
            shotId: promptShot.shot_id ?? "shot",
            timeRange: promptShot.time_range ?? null,
            duration: shotDuration(promptShot),
            prompt: promptShot.partial_prompt ?? "",
          })),
          videoPath,
          videoStatus: mediaPaths?.includes(videoPath) ? "generated" : "not_generated",
        } satisfies StoryboardGenerationUnit;
      }),
  );
}

export function splitStoryboardText(
  source: string,
  dict: Record<string, string>,
): string[] {
  return resolveRefs(source, dict)
    .split(/\s*→\s*/g)
    .map((part) => stripActionPrefix(part))
    .filter(Boolean);
}

export function buildClipInspectorData(
  scene: StoryboardSceneLike,
  clip: StoryboardClipLike,
  dict: Record<string, string>,
): ClipInspectorData {
  const shots = clip.shots ?? [];
  const shotPrompts = shots
    .map((shot) => resolveRefs(shot.partial_prompt ?? shot.partial_prompt_v2 ?? "", dict).trim())
    .filter(Boolean);

  const promptPreview = resolveRefs(
    clip.complete_prompt_v2 ?? clip.complete_prompt ?? shotPrompts.join("\n"),
    dict,
  ).trim();

  return {
    location: resolveName(scene.locations?.[0]?.location_id, dict),
    environment: [spaceCode(scene.environment?.space), scene.environment?.time?.toUpperCase()]
      .filter(Boolean)
      .join(" · ") || null,
    characters: uniqueNames((scene.actors ?? []).map((actor) => resolveName(actor.actor_id, dict))),
    props: uniqueNames((scene.props ?? []).map((prop) => resolveName(prop.prop_id, dict))),
    scriptSource: stripActionPrefix(resolveRefs(clip.script_source ?? "", dict)),
    layoutPrompt: resolveRefs(clip.layout_prompt ?? "", dict).trim(),
    sfxPrompt: resolveRefs(clip.sfx_prompt ?? "", dict).trim(),
    promptPreview,
    shotCount: shots.length,
    totalDuration: shots.reduce((sum, shot) => sum + shotDuration(shot), 0),
    expectedDuration: clip.expected_duration ?? null,
  };
}

export function buildStoryboardEditorModel(
  storyboardPath: string,
  scenes: ReadonlyArray<StoryboardSceneLike & {
    scene_id: string;
    clips?: ReadonlyArray<StoryboardClipLike & {
      clip_id: string;
      shots?: ReadonlyArray<StoryboardShotLike>;
    }>;
    shots?: ReadonlyArray<StoryboardShotLike>;
  }>,
  dict: Record<string, string>,
  availablePaths?: Iterable<string>,
): StoryboardEditorModel {
  const mediaPaths = availablePaths
    ? Array.from(new Set(Array.from(availablePaths).filter(isVideoPath)))
    : undefined;
  const clips: StoryboardEditorClip[] = [];
  const shots: StoryboardEditorShot[] = [];
  let episodeOffset = 0;

  scenes.forEach((scene, sceneIndex) => {
    const sceneClips = scene.clips && scene.clips.length > 0 ? scene.clips : scenePromptClips(scene);
    sceneClips.forEach((clip, clipIndex) => {
      const key = `${scene.scene_id}::${clip.clip_id}`;
      let clipOffset = 0;
      const clipShots = (clip.shots ?? []).map((shot, shotIndex) => {
        const duration = shotDuration(shot);
        const localStartOffset = clipOffset;
        const localEndOffset = localStartOffset + duration;
        const startOffset = episodeOffset + localStartOffset;
        const endOffset = episodeOffset + localEndOffset;

        clipOffset = localEndOffset;

        return {
          key: `${key}::${shot.shot_id ?? `shot_${shotIndex + 1}`}`,
          clipKey: key,
          sceneId: scene.scene_id,
          clipId: clip.clip_id,
          shotId: shot.shot_id ?? `shot_${shotIndex + 1}`,
          timeRange: shot.time_range ?? null,
          duration,
          localStartOffset,
          localEndOffset,
          startOffset,
          endOffset,
          prompt: resolveRefs(shot.partial_prompt ?? shot.partial_prompt_v2 ?? "", dict).trim(),
        };
      });

      const totalDuration =
        clipShots.reduce((sum, shot) => sum + shot.duration, 0) ||
        numericDuration(clip.expected_duration) ||
        1;
      const startOffset = episodeOffset;
      const endOffset = startOffset + totalDuration;

      const displayText = stripActionPrefix(
        resolveRefs(clip.script_source ?? clip.complete_prompt ?? clip.complete_prompt_v2 ?? "", dict),
      );

      const editorClip = {
        key,
        sceneId: scene.scene_id,
        sceneIndex,
        clipId: clip.clip_id,
        clipIndex,
        videoPath: resolveClipVideoPath(storyboardPath, scene.scene_id, clip.clip_id, mediaPaths),
        expectedDuration: clip.expected_duration ?? null,
        totalDuration,
        startOffset,
        endOffset,
        shotCount: clipShots.length,
        displayText,
        shots: clipShots,
      } satisfies StoryboardEditorClip;

      clips.push(editorClip);
      shots.push(...clipShots);
      episodeOffset = endOffset;
    });
  });

  return {
    clips,
    shots,
    defaultClipKey: clips[0]?.key ?? null,
    defaultShotKey: shots[0]?.key ?? null,
    totalDuration: episodeOffset,
    episodeVideoPath: resolveEpisodeVideoPath(storyboardPath, mediaPaths),
  };
}

export function resolveStoryboardSelectionAtTime(
  model: StoryboardEditorModel,
  episodeTime: number,
): { clipKey: string | null; shotKey: string | null } {
  if (model.clips.length === 0) {
    return { clipKey: null, shotKey: null };
  }

  const boundedTime = Math.max(0, episodeTime);
  const activeClip =
    model.clips.find((clip) => boundedTime >= clip.startOffset && boundedTime < clip.endOffset) ??
    model.clips.at(-1) ??
    null;
  const activeShot =
    model.shots.find((shot) => boundedTime >= shot.startOffset && boundedTime < shot.endOffset) ??
    model.shots.at(-1) ??
    null;

  return {
    clipKey: activeClip?.key ?? null,
    shotKey: activeShot?.key ?? activeClip?.shots[0]?.key ?? null,
  };
}
