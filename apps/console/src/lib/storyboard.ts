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
  shotId: string;
  timeRange: string | null;
  duration: number;
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
  shotCount: number;
  displayText: string;
  shots: StoryboardEditorShot[];
}

export interface StoryboardEditorModel {
  clips: StoryboardEditorClip[];
  defaultClipKey: string | null;
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

function spaceCode(space: string | undefined): string | null {
  if (!space) return null;
  if (space === "interior") return "INT";
  if (space === "exterior") return "EXT";
  return space.toUpperCase();
}

function compactStoryboardId(id: string): string {
  return id.trim().replace(/_/g, "");
}

function episodeSlugFromPath(storyboardPath: string): string {
  const match = storyboardPath.match(/(?:^|\/)(ep_?\d+)(?=\/)/i);
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
): StoryboardEditorModel {
  const clips: StoryboardEditorClip[] = [];

  scenes.forEach((scene, sceneIndex) => {
    (scene.clips ?? []).forEach((clip, clipIndex) => {
      const key = `${scene.scene_id}::${clip.clip_id}`;
      const shots = (clip.shots ?? []).map((shot, shotIndex) => ({
        key: `${key}::${shot.shot_id ?? `shot_${shotIndex + 1}`}`,
        shotId: shot.shot_id ?? `shot_${shotIndex + 1}`,
        timeRange: shot.time_range ?? null,
        duration: shotDuration(shot),
        prompt: resolveRefs(shot.partial_prompt ?? shot.partial_prompt_v2 ?? "", dict).trim(),
      }));

      const displayText = stripActionPrefix(
        resolveRefs(clip.script_source ?? clip.complete_prompt ?? clip.complete_prompt_v2 ?? "", dict),
      );

      clips.push({
        key,
        sceneId: scene.scene_id,
        sceneIndex,
        clipId: clip.clip_id,
        clipIndex,
        videoPath: clipVideoPath(storyboardPath, scene.scene_id, clip.clip_id),
        expectedDuration: clip.expected_duration ?? null,
        totalDuration: shots.reduce((sum, shot) => sum + shot.duration, 0),
        shotCount: shots.length,
        displayText,
        shots,
      });
    });
  });

  return {
    clips,
    defaultClipKey: clips[0]?.key ?? null,
  };
}
