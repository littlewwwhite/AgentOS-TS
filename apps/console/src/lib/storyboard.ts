import { resolveRefs } from "./fountain";

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

function episodeSlugFromPath(storyboardPath: string): string {
  const basename = basenameOf(storyboardPath);
  const match =
    basename.match(/(ep_?\d+)(?=_storyboard\.json$|\.json$)/i) ??
    storyboardPath.match(/(?:^|\/)(ep_?\d+)(?=\/)/i);
  return match ? compactStoryboardId(match[1]) : "ep";
}

export function clipVideoPath(
  storyboardPath: string,
  sceneId: string,
  clipId: string,
): string {
  const episodeDir = storyboardPath.replace(/\/[^/]+$/, "");
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

  const episodeDir = dirnameOf(storyboardPath);
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

  const episodeDir = dirnameOf(storyboardPath);
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

export function durationFromRange(range: string | undefined): number | null {
  if (!range) return null;
  const match = range.match(/(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

export function shotDuration(shot: StoryboardShotLike): number {
  if (typeof shot.duration === "number" && Number.isFinite(shot.duration) && shot.duration > 0) {
    return shot.duration;
  }
  return durationFromRange(shot.time_range) ?? 1;
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
    (scene.clips ?? []).forEach((clip, clipIndex) => {
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
