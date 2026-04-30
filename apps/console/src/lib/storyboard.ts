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
  // Indices into the script scene's actions[] array that this prompt covers.
  // Empty when the storyboard shot did not declare source_refs.
  sourceRefs: number[];
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

export type ProductionAssetKind = "actor" | "location" | "prop";
export type ProductionAssetScope = "current" | "episode" | "project";

export interface ProductionAssetRailItem {
  kind: ProductionAssetKind;
  id: string;
  label: string;
  scope: ProductionAssetScope;
  thumbnailPath: string | null;
}

export interface ProductionAssetRailModel {
  groups: Record<ProductionAssetKind, { label: string; items: ProductionAssetRailItem[] }>;
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

function isImagePath(path: string): boolean {
  return /\.(?:png|jpe?g|webp)$/i.test(path);
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
  const clipSlugCandidates = [clipSlug];
  const partMatch = clipSlug.match(/^part(\d+)$/i);
  if (partMatch?.[1]) clipSlugCandidates.push(`clip${partMatch[1]}`);
  if (clipSlug.startsWith(sceneSlug)) {
    const withoutScene = clipSlug.slice(sceneSlug.length);
    if (withoutScene) clipSlugCandidates.push(withoutScene);
  }
  const uniqueClipSlugs = Array.from(new Set(clipSlugCandidates));
  const fileStems = uniqueClipSlugs.map((slug) => `${episodeSlug}_${sceneSlug}_${slug}`);

  const preferredCandidates = [
    ...fileStems.flatMap((fileStem, index) => [
      `${episodeDir}/${sceneSlug}/${uniqueClipSlugs[index]}/${fileStem}.mp4`,
      `${episodeDir}/${sceneSlug}/${fileStem}.mp4`,
    ]),
    fallbackPath,
  ];

  for (const candidate of preferredCandidates) {
    if (availablePaths.includes(candidate)) return candidate;
  }

  const variantPatterns = fileStems.map((fileStem) => new RegExp(`^${escapeRegExp(fileStem)}(?:_(\\d+))?$`, "i"));
  const scopedMatches = availablePaths
    .filter((path) => path.startsWith(`${episodeDir}/`))
    .map((path) => {
      const stem = stripExtension(basenameOf(path));
      const patternIndex = variantPatterns.findIndex((pattern) => pattern.test(stem));
      return patternIndex >= 0 ? { path, patternIndex, stem } : null;
    })
    .filter((match): match is { path: string; patternIndex: number; stem: string } => match !== null)
    .sort((left, right) => {
      if (left.patternIndex !== right.patternIndex) return left.patternIndex - right.patternIndex;
      const leftMatch = left.stem.match(variantPatterns[left.patternIndex]);
      const rightMatch = right.stem.match(variantPatterns[right.patternIndex]);
      const leftVariant = leftMatch?.[1] ? Number(leftMatch[1]) : 0;
      const rightVariant = rightMatch?.[1] ? Number(rightMatch[1]) : 0;
      if (leftVariant !== rightVariant) return leftVariant - rightVariant;
      if (left.path.length !== right.path.length) return left.path.length - right.path.length;
      return left.path.localeCompare(right.path);
    });

  return scopedMatches[0]?.path ?? fallbackPath;
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

function durationText(seconds: number | undefined): string | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
}

function scenePromptClips(
  scene: StoryboardSceneLike & {
    scene_id: string;
    shots?: ReadonlyArray<StoryboardShotLike>;
  },
): Array<StoryboardClipLike & { clip_id: string; shots?: ReadonlyArray<StoryboardShotLike> }> {
  return (scene.shots ?? [])
    .filter((shot) => typeof shot.prompt === "string" && shot.prompt.trim())
    .map((shot, index) => {
      const prompt = shot.prompt ?? "";
      const nestedShots = storyboardShotsFromPrompt(prompt);
      const duration = typeof shot.duration === "number" && Number.isFinite(shot.duration) && shot.duration > 0
        ? shot.duration
        : undefined;
      return {
        clip_id: `part_${String(index + 1).padStart(3, "0")}`,
        expected_duration: durationText(duration),
        script_source: storyboardPromptSummary(prompt),
        shots: nestedShots.length > 0
          ? nestedShots
          : [{
              shot_id: "shot_001",
              duration,
              partial_prompt: prompt,
            }],
      };
    });
}

function assetDir(kind: ProductionAssetKind): string {
  if (kind === "actor") return "output/actors";
  if (kind === "location") return "output/locations";
  return "output/props";
}

function thumbnailForAsset(
  kind: ProductionAssetKind,
  id: string,
  label: string,
  availablePaths: ReadonlyArray<string>,
): string | null {
  const prefixes = [`${assetDir(kind)}/${id}/`];
  if (label && label !== id) prefixes.push(`${assetDir(kind)}/${label}/`);

  function imageRank(path: string): number {
    const directoryRank = kind === "actor" && path.includes("/default/") ? 0 : 10;
    const base = basenameOf(path);
    if (base.includes("三视图")) return directoryRank + 0;
    if (base.includes("多视图") || base.includes("多角度")) return directoryRank + 0;
    if (base.includes("主图")) return directoryRank + 1;
    if (base.includes("正面")) return directoryRank + 2;
    return directoryRank + 3;
  }

  return availablePaths
    .filter((path) => prefixes.some((prefix) => path.startsWith(prefix)) && isImagePath(path))
    .sort((a, b) => {
      const rank = imageRank(a) - imageRank(b);
      return rank === 0 ? a.localeCompare(b) : rank;
    })[0] ?? null;
}

function addAssetRef(
  refs: Map<string, ProductionAssetScope>,
  id: string | null | undefined,
  scope: ProductionAssetScope,
) {
  if (!id) return;
  const existing = refs.get(id);
  if (existing === "current" || (existing === "episode" && scope === "project")) return;
  refs.set(id, scope === "current" || scope === "episode" ? scope : existing ?? scope);
}

function sceneAssetIds(scene: StoryboardSceneLike, kind: ProductionAssetKind): string[] {
  if (kind === "actor") {
    return (scene.actors ?? []).map((asset) => asset.actor_id).filter((id): id is string => Boolean(id));
  }
  if (kind === "location") {
    return (scene.locations ?? []).map((asset) => asset.location_id).filter((id): id is string => Boolean(id));
  }
  return (scene.props ?? []).map((asset) => asset.prop_id).filter((id): id is string => Boolean(id));
}

export function assetKindFromId(id: string): ProductionAssetKind | null {
  if (id.startsWith("act_")) return "actor";
  if (id.startsWith("loc_")) return "location";
  if (id.startsWith("prp_") || id.startsWith("prop_")) return "prop";
  return null;
}

function knownAssetIds(dict: Record<string, string>, kind: ProductionAssetKind): string[] {
  return Object.keys(dict)
    .map((id) => id.toLowerCase())
    .filter((id) => assetKindFromId(id) === kind)
    .sort((left, right) => left.localeCompare(right));
}

function extractAssetRefsFromText(text: string): Array<{ kind: ProductionAssetKind; id: string }> {
  const refs: Array<{ kind: ProductionAssetKind; id: string }> = [];
  const seen = new Set<string>();
  const matches = text.matchAll(/(?:@|\{)?((?:act|loc|prp|prop)_\d+)(?::st_\d+)?(?:\})?/gi);
  for (const match of matches) {
    const id = match[1]?.toLowerCase();
    if (!id || seen.has(id)) continue;
    const kind = assetKindFromId(id);
    if (!kind) continue;
    seen.add(id);
    refs.push({ kind, id });
  }
  return refs;
}

function scenePromptTexts(scene: StoryboardSceneLike): string[] {
  const texts: string[] = [];
  const withPrompts = scene as StoryboardSceneLike & {
    shots?: ReadonlyArray<StoryboardShotLike>;
    clips?: ReadonlyArray<StoryboardClipLike>;
  };

  for (const shot of withPrompts.shots ?? []) {
    for (const value of [shot.prompt, shot.partial_prompt, shot.partial_prompt_v2]) {
      if (typeof value === "string" && value.trim()) texts.push(value);
    }
  }

  for (const clip of withPrompts.clips ?? []) {
    for (const value of [
      clip.script_source,
      clip.layout_prompt,
      clip.complete_prompt,
      clip.complete_prompt_v2,
      clip.sfx_prompt,
    ]) {
      if (typeof value === "string" && value.trim()) texts.push(value);
    }
    for (const shot of clip.shots ?? []) {
      for (const value of [shot.prompt, shot.partial_prompt, shot.partial_prompt_v2]) {
        if (typeof value === "string" && value.trim()) texts.push(value);
      }
    }
  }

  return texts;
}

export function buildProductionAssetRailModel(input: {
  scenes: ReadonlyArray<StoryboardSceneLike & { scene_id?: string }>;
  currentSceneId: string | null | undefined;
  dict: Record<string, string>;
  availablePaths?: Iterable<string>;
}): ProductionAssetRailModel {
  const paths = input.availablePaths ? Array.from(input.availablePaths) : [];
  const kinds: Array<{ kind: ProductionAssetKind; label: string }> = [
    { kind: "actor", label: "角色" },
    { kind: "location", label: "场景" },
    { kind: "prop", label: "道具" },
  ];

  const groups = Object.fromEntries(
    kinds.map(({ kind, label }) => {
      const refs = new Map<string, ProductionAssetScope>();
      for (const scene of input.scenes) {
        const scope = scene.scene_id === input.currentSceneId ? "current" : "episode";
        for (const id of sceneAssetIds(scene, kind)) {
          addAssetRef(refs, id, scope);
        }
        for (const text of scenePromptTexts(scene)) {
          for (const ref of extractAssetRefsFromText(text)) {
            if (ref.kind === kind) addAssetRef(refs, ref.id, scope);
          }
        }
      }
      for (const id of knownAssetIds(input.dict, kind)) {
        addAssetRef(refs, id, "project");
      }

      const items = Array.from(refs.entries())
        .map(([id, scope]) => {
          const label = input.dict[id] ?? id;
          return {
            kind,
            id,
            label,
            scope,
            thumbnailPath: thumbnailForAsset(kind, id, label, paths),
          };
        })
        .sort((left, right) => {
          const scopeRank: Record<ProductionAssetScope, number> = { current: 0, episode: 1, project: 2 };
          if (left.scope !== right.scope) return scopeRank[left.scope] - scopeRank[right.scope];
          return left.id.localeCompare(right.id);
        });

      return [kind, { label, items }];
    }),
  ) as ProductionAssetRailModel["groups"];

  return { groups };
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
        const refs = Array.isArray(shot.source_refs)
          ? (shot.source_refs as unknown[])
              .map((value) => (typeof value === "number" ? value : Number(value)))
              .filter((value) => Number.isInteger(value) && value >= 0)
          : [];

        return {
          key: `${scene.scene_id}::${partId}`,
          sceneId: scene.scene_id,
          partId,
          promptPath: `scenes.${sceneIndex}.shots.${index}.prompt`,
          prompt: storyboardGenerationPromptText(rawPrompt),
          rawPrompt,
          sourceRefs: refs,
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
