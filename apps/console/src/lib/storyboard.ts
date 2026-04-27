// input: storyboard JSON fragments, project paths, and optional reference dictionaries
// output: editor timelines, editable video prompts, media paths, and selection helpers
// pos: shared domain helpers behind rendered storyboard editing and playback

import {
  buildRefDict,
  resolveRefs,
  type ScriptJson,
} from "./fountain";

export interface ScriptSceneAction {
  kind: "action" | "dialogue";
  actorName: string | null;
  text: string;
}

export interface ScriptSceneSnapshot {
  sceneId: string;
  episodeId: string | null;
  actions: ScriptSceneAction[];
}
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

export interface StoryboardGenerationUnit {
  key: string;
  sceneId: string;
  partId: string;
  promptPath: string;
  prompt: string;
  rawPrompt: string;
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

export interface EditableStoryboardShot {
  shotId: string;
  timeRange: string;
  cameraSetup: string;
  cameraSetupShape: "string" | "object";
  beats: string[];
  extras: Record<string, unknown>;
}

export interface EditableStoryboardPrompt {
  partLabel: string;
  preamble: string;
  shots: EditableStoryboardShot[];
  hasJson: boolean;
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

type StoryboardPromptJsonSlice = {
  text: string;
  start: number;
  end: number;
};

function trimSlice(text: string, start: number, end: number): StoryboardPromptJsonSlice {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart < nextEnd && /\s/.test(text[nextStart] ?? "")) nextStart += 1;
  while (nextEnd > nextStart && /\s/.test(text[nextEnd - 1] ?? "")) nextEnd -= 1;
  return {
    text: text.slice(nextStart, nextEnd),
    start: nextStart,
    end: nextEnd,
  };
}

function extractFencedStoryboardJsonSlice(text: string): StoryboardPromptJsonSlice | null {
  const match = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  const body = match?.[1];
  if (!match || body === undefined || !/"shots"\s*:/.test(body)) return null;
  const bodyStart = match.index + match[0].indexOf(body);
  return trimSlice(text, bodyStart, bodyStart + body.length);
}

function extractParsedStoryboardJsonSlice(text: string): (StoryboardPromptJsonSlice & { parsed: { shots?: unknown[] } }) | null {
  const starts = Array.from(text.matchAll(/\{\s*"shots"\s*:/g), (match) => match.index ?? -1)
    .filter((index) => index >= 0)
    .reverse();

  for (const start of starts) {
    let end = text.lastIndexOf("}");
    while (end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as { shots?: unknown }).shots)) {
          return {
            ...trimSlice(text, start, end + 1),
            parsed: parsed as { shots?: unknown[] },
          };
        }
      } catch {
        // Try the previous closing brace; draft prompts often contain prose before JSON.
      }
      end = text.lastIndexOf("}", end - 1);
    }
  }

  return null;
}

function extractStoryboardPromptJsonSlice(text: string): StoryboardPromptJsonSlice | null {
  return extractFencedStoryboardJsonSlice(text) ?? extractParsedStoryboardJsonSlice(text);
}

function extractStoryboardShotsObject(text: string): { shots?: unknown[] } | null {
  return extractParsedStoryboardJsonSlice(text)?.parsed ?? null;
}

export function storyboardGenerationPromptText(prompt: string): string {
  return extractStoryboardPromptJsonSlice(prompt)?.text ?? prompt;
}

export function replaceStoryboardGenerationPromptText(originalPrompt: string, editedPrompt: string): string {
  const slice = extractStoryboardPromptJsonSlice(originalPrompt);
  if (!slice) return editedPrompt;
  return `${originalPrompt.slice(0, slice.start)}${editedPrompt.trim()}${originalPrompt.slice(slice.end)}`;
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

function objectCameraSetupToString(value: Record<string, unknown>): string {
  const type = coerceString(value.type);
  return type ?? JSON.stringify(value);
}

const KNOWN_SHOT_KEYS = new Set(["shot_id", "time_range", "camera_setup", "beats"]);

function extractPreambleBeforeJson(rawPrompt: string): string {
  const slice = extractStoryboardPromptJsonSlice(rawPrompt);
  const upTo = slice ? rawPrompt.slice(0, slice.start) : rawPrompt;
  const lines = upTo.split(/\r?\n/);
  const narrative = lines
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !/^```/.test(line))
    .join("\n");
  return narrative || extractDraftSummary(rawPrompt) || "";
}

export function parseEditableStoryboardPrompt(rawPrompt: string): EditableStoryboardPrompt {
  const parsed = extractStoryboardShotsObject(rawPrompt);
  const partLabel = rawPrompt.split(/\r?\n/, 1)[0]?.trim() || "PART";
  const preamble = extractPreambleBeforeJson(rawPrompt);

  const shotsRaw = (parsed?.shots ?? [])
    .filter((shot): shot is Record<string, unknown> => !!shot && typeof shot === "object" && !Array.isArray(shot));

  const shots: EditableStoryboardShot[] = shotsRaw.map((shot, index) => {
    const cameraSetup = shot.camera_setup;
    let cameraSetupString = "";
    let cameraSetupShape: "string" | "object" = "string";
    if (typeof cameraSetup === "string") {
      cameraSetupString = cameraSetup;
      cameraSetupShape = "string";
    } else if (cameraSetup && typeof cameraSetup === "object" && !Array.isArray(cameraSetup)) {
      cameraSetupString = objectCameraSetupToString(cameraSetup as Record<string, unknown>);
      cameraSetupShape = "object";
    }

    const beats = Array.isArray(shot.beats)
      ? shot.beats
          .map((beat) => (typeof beat === "string" ? beat.trim() : ""))
          .filter(Boolean)
      : [];

    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(shot)) {
      if (!KNOWN_SHOT_KEYS.has(key)) extras[key] = value;
    }

    return {
      shotId: typeof shot.shot_id === "string" && shot.shot_id ? shot.shot_id : `S${index + 1}`,
      timeRange: typeof shot.time_range === "string" ? shot.time_range : "",
      cameraSetup: cameraSetupString,
      cameraSetupShape,
      beats,
      extras,
    };
  });

  return {
    partLabel,
    preamble,
    shots,
    hasJson: parsed !== null,
  };
}

function shotToMarkdownBlock(shot: EditableStoryboardShot): string {
  const header = shot.timeRange
    ? `**${shot.shotId}**（${shot.timeRange}）`
    : `**${shot.shotId}**`;

  const lines: string[] = [header];
  if (shot.cameraSetup) lines.push(shot.cameraSetup);
  for (const beat of shot.beats) {
    if (beat.trim()) lines.push(`- ${beat.trim()}`);
  }
  return lines.join("\n");
}

export function storyboardPromptAsMarkdown(rawPrompt: string): string {
  const editable = parseEditableStoryboardPrompt(rawPrompt);
  if (!editable.hasJson) return rawPrompt;

  const sections: string[] = [];
  if (editable.partLabel) sections.push(editable.partLabel);
  if (editable.preamble) sections.push(editable.preamble);
  for (const shot of editable.shots) {
    sections.push(shotToMarkdownBlock(shot));
  }
  return sections.join("\n\n").trim();
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

  for (const extension of ["mp4", "mov", "webm"]) {
    const exactBasename = `${episodeSlug}.${extension}`;
    const exactCandidate = episodeDir ? `${episodeDir}/${exactBasename}` : exactBasename;

    if (availablePaths.includes(exactCandidate)) return exactCandidate;

    const siblingMatch = availablePaths.find(
      (path) => dirnameOf(path) === episodeDir && basenameOf(path) === exactBasename,
    );
    if (siblingMatch) return siblingMatch;
  }

  return null;
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

export function findScriptSceneSnapshot(
  scriptData: ScriptJson | null | undefined,
  sceneId: string,
  dict: Record<string, string>,
): ScriptSceneSnapshot | null {
  if (!scriptData?.episodes) return null;
  const targetCompact = compactStoryboardId(sceneId);

  for (const episode of scriptData.episodes) {
    const scenes = episode?.scenes ?? [];
    for (const scene of scenes) {
      const sceneIdValue = typeof scene?.scene_id === "string" ? scene.scene_id : "";
      if (!sceneIdValue) continue;
      if (sceneIdValue !== sceneId && compactStoryboardId(sceneIdValue) !== targetCompact) continue;

      const actions: ScriptSceneAction[] = (scene.actions ?? [])
        .map((entry): ScriptSceneAction => {
          if (entry.type === "dialogue") {
            const actorId = entry.actor_id;
            const actorName = actorId ? (dict[actorId] ?? actorId) : null;
            return {
              kind: "dialogue",
              actorName,
              text: resolveRefs(entry.content ?? "", dict).trim(),
            };
          }
          return {
            kind: "action",
            actorName: null,
            text: resolveRefs(entry.content ?? "", dict).trim(),
          };
        })
        .filter((action) => action.text.length > 0);

      return {
        sceneId: sceneIdValue,
        episodeId: typeof episode.episode_id === "string" ? episode.episode_id : null,
        actions,
      };
    }
  }
  return null;
}

export function buildStoryboardGenerationUnits(
  scenes: ReadonlyArray<StoryboardSceneLike & {
    scene_id: string;
    shots?: ReadonlyArray<StoryboardShotLike>;
  }>,
): StoryboardGenerationUnit[] {
  return scenes.flatMap((scene, sceneIndex) =>
    (scene.shots ?? [])
      .filter((shot) => typeof shot.prompt === "string" && shot.prompt.trim())
      .map((shot, index) => {
        const partId = `part_${String(index + 1).padStart(3, "0")}`;
        const rawPrompt = shot.prompt ?? "";

        return {
          key: `${scene.scene_id}::${partId}`,
          sceneId: scene.scene_id,
          partId,
          promptPath: `scenes.${sceneIndex}.shots.${index}.prompt`,
          prompt: storyboardGenerationPromptText(rawPrompt),
          rawPrompt,
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
