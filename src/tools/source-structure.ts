import fs from "node:fs/promises";
import path from "node:path";

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const DEFAULT_MAX_CHARS_PER_SEGMENT = 8_000;
const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 100;
const MIN_SEGMENT_LENGTH = 100;

const EXPLICIT_MARKER_RE = /^[\t ]*(?:[#=]+[\t ]*)?(?:第[\t 0-9０-９一二三四五六七八九十百千零〇两]{1,20}[集话章节幕回卷部篇]|(?:EP|Episode|Chapter|Part|Volume|Section|Act)\s*[-#:.]?\s*[0-9０-９]{1,4}|(?:序章|序言|楔子|引子|前言|开篇|尾声|终章|后记|番外|完结|大结局)|卷[一二三四五六七八九十百0-9０-９]{1,10}|[上中下]篇|[【「『〖]第[\t 0-9０-９一二三四五六七八九十百千零〇两]{1,20}[集话章节幕回卷部篇][】」』〗])[^\n]*$/gim;
const NUMBERED_TITLE_RE = /^[\t ]*(?:[0-9０-９]{1,4}[\t ]*[.．。、)）]\s*[^\n]{2,100}|[（(][0-9０-９]{1,4}[)）]\s*[^\n]{2,100})$/gm;
const STANDALONE_NUMBER_RE = /^[\t ]*([0-9０-９]{1,3})[\t ]*$/gm;
const SCENE_MARKER_RE = /^[\t ]*(?:第)?(\d{1,3})-(\d{1,3})(?:场)?(?:\s+.{0,100})?$/gm;

export type SourceStructureStrategy =
  | "explicit_markers"
  | "numbered_titles"
  | "standalone_numbers"
  | "scene_markers"
  | "chunk_fallback";

export type SourceStructureMode = "authoritative_segments" | "fallback_chunks";

export interface SourceSegment {
  segment_id: string;
  parent_segment_id: string | null;
  title: string;
  content: string;
  source_episode: number | null;
  split_part: number;
  split_parts: number;
  char_count: number;
}

export interface SourceStructure {
  version: 1;
  strategy: SourceStructureStrategy;
  source_mode: SourceStructureMode;
  quality: {
    coverage_ratio: number;
    continuity_ok: boolean;
    min_segment_length: number;
    total_segments: number;
  };
  segments: SourceSegment[];
}

export interface DetectSourceStructureOptions {
  maxCharsPerSegment?: number;
}

export interface DetectSourceStructureProjectResult {
  project_path: string;
  source_path: string;
  output_path: string;
  structure: SourceStructure;
}

interface RawSegment {
  title: string;
  content: string;
  sourceEpisode: number | null;
}

function normalizeText(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").trim();
}

function convertFullWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xff10 + 48));
}

function extractEpisodeNumber(title: string): number | null {
  if (!title) return null;

  const arabicMatch = convertFullWidthDigits(title).match(
    /(?:第|EP|Episode|Chapter|Part|Volume|Section|Act)?\s*(\d+)/i,
  );
  if (arabicMatch) return Number.parseInt(arabicMatch[1], 10);

  const zhMatch = title.match(/第([一二三四五六七八九十百零〇两]+)[集话章节回幕]/);
  if (!zhMatch) return null;

  const numerals = zhMatch[1];
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (numerals === "十") return 10;
  if (numerals.startsWith("十")) return 10 + (digitMap[numerals.slice(1)] ?? 0);
  if (numerals.endsWith("十")) return (digitMap[numerals.slice(0, -1)] ?? 0) * 10;
  if (numerals.includes("十")) {
    const [tens, ones] = numerals.split("十");
    return (digitMap[tens] ?? 0) * 10 + (digitMap[ones] ?? 0);
  }

  return digitMap[numerals] ?? null;
}

function checkContinuity(segments: RawSegment[]): boolean {
  const numbers = segments
    .map((segment) => extractEpisodeNumber(segment.title))
    .filter((value): value is number => value !== null);

  if (numbers.length < Math.ceil(segments.length * 0.8)) return false;

  const sorted = [...numbers].sort((left, right) => left - right);
  return sorted.every((value, index) => index === 0 || value === sorted[index - 1] + 1);
}

function chunkTextByNewlines(text: string, maxChars: number): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const hardEnd = Math.min(normalized.length, cursor + maxChars);
    if (hardEnd >= normalized.length) {
      chunks.push(normalized.slice(cursor).trim());
      break;
    }

    const searchStart = Math.min(normalized.length, cursor + Math.floor(maxChars * 0.6));
    let splitAt = -1;

    for (const delimiter of ["\n\n", "。\n", "！\n", "？\n", "!\n", "?\n", "\n"]) {
      const found = normalized.lastIndexOf(delimiter, hardEnd);
      if (found >= searchStart && found > splitAt) {
        splitAt = found + delimiter.length;
      }
    }

    if (splitAt <= cursor) splitAt = hardEnd;
    chunks.push(normalized.slice(cursor, splitAt).trim());
    cursor = splitAt;
  }

  return chunks.filter(Boolean);
}

function buildSegmentsFromMatches(matches: RegExpMatchArray[], text: string): RawSegment[] {
  const segments: RawSegment[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).trim();
    if (!content) continue;

    const title = content.split("\n")[0]?.trim() || `Episode ${segments.length + 1}`;
    segments.push({
      title,
      content,
      sourceEpisode: extractEpisodeNumber(title),
    });
  }

  return segments;
}

function splitByExplicitMarkers(text: string): RawSegment[] {
  const matches = [...text.matchAll(EXPLICIT_MARKER_RE)];
  if (matches.length < MIN_SEGMENTS || matches.length > MAX_SEGMENTS) return [];
  return buildSegmentsFromMatches(matches, text);
}

function splitByNumberedTitles(text: string): RawSegment[] {
  const matches = [...text.matchAll(NUMBERED_TITLE_RE)];
  if (matches.length < MIN_SEGMENTS || matches.length > MAX_SEGMENTS) return [];
  return buildSegmentsFromMatches(matches, text);
}

function splitByStandaloneNumbers(text: string): RawSegment[] {
  const matches = [...text.matchAll(STANDALONE_NUMBER_RE)];
  if (matches.length < MIN_SEGMENTS || matches.length > MAX_SEGMENTS) return [];

  const numbers = matches.map((match) => Number.parseInt(convertFullWidthDigits(match[1]), 10));
  const isSequential =
    numbers[0] <= 10 &&
    numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1);
  if (!isSequential) return [];

  const segments: RawSegment[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const content = text.slice(start, end).trim();
    if (!content) continue;

    const lines = content.split("\n");
    const suffix = lines[1]?.trim() ? ` ${lines[1].trim().slice(0, 30)}` : "";
    segments.push({
      title: `第${numbers[index]}集${suffix}`,
      content,
      sourceEpisode: numbers[index],
    });
  }

  return segments;
}

function splitBySceneMarkers(text: string): RawSegment[] {
  const matches = [...text.matchAll(SCENE_MARKER_RE)];
  if (matches.length < 3) return [];

  const episodeStarts = new Map<number, number>();
  for (const match of matches) {
    const episode = Number.parseInt(match[1], 10);
    if (!episodeStarts.has(episode)) {
      episodeStarts.set(episode, match.index ?? 0);
    }
  }

  return [...episodeStarts.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([episode, start], index, ordered) => ({
      title: `Episode ${episode}`,
      content: text.slice(start, ordered[index + 1]?.[1] ?? text.length).trim(),
      sourceEpisode: episode,
    }))
    .filter((segment) => segment.content);
}

function fallbackChunks(text: string, maxCharsPerSegment: number): RawSegment[] {
  return chunkTextByNewlines(text, maxCharsPerSegment).map((content, index) => ({
    title: `Chunk ${index + 1}`,
    content,
    sourceEpisode: index + 1,
  }));
}

function computeCoverageRatio(segments: RawSegment[], text: string): number {
  if (!text) return 0;
  return segments.reduce((total, segment) => total + segment.content.length, 0) / text.length;
}

function selectSegments(
  text: string,
  maxCharsPerSegment: number,
): {
  strategy: SourceStructureStrategy;
  sourceMode: SourceStructureMode;
  segments: RawSegment[];
} {
  const candidates: Array<[SourceStructureStrategy, RawSegment[]]> = [
    ["explicit_markers", splitByExplicitMarkers(text)],
    ["numbered_titles", splitByNumberedTitles(text)],
    ["standalone_numbers", splitByStandaloneNumbers(text)],
    ["scene_markers", splitBySceneMarkers(text)],
  ];

  for (const [strategy, segments] of candidates) {
    if (!segments.length) continue;

    const coverageRatio = computeCoverageRatio(segments, text);
    const minSegmentLength = Math.min(...segments.map((segment) => segment.content.length));
    const continuityOk = checkContinuity(segments);

    if (
      coverageRatio >= 0.9 &&
      segments.length >= MIN_SEGMENTS &&
      segments.length <= MAX_SEGMENTS &&
      (continuityOk || minSegmentLength >= MIN_SEGMENT_LENGTH)
    ) {
      return {
        strategy,
        sourceMode: "authoritative_segments",
        segments,
      };
    }
  }

  return {
    strategy: "chunk_fallback",
    sourceMode: "fallback_chunks",
    segments: fallbackChunks(text, maxCharsPerSegment),
  };
}

function expandSegments(segments: RawSegment[], maxCharsPerSegment: number): SourceSegment[] {
  const expanded: SourceSegment[] = [];

  for (const [index, segment] of segments.entries()) {
    const rootId = `seg_${String(index + 1).padStart(3, "0")}`;
    const chunks =
      segment.content.length > maxCharsPerSegment
        ? chunkTextByNewlines(segment.content, maxCharsPerSegment)
        : [segment.content];

    for (const [partIndex, content] of chunks.entries()) {
      expanded.push({
        segment_id: chunks.length === 1 ? rootId : `${rootId}_p${partIndex + 1}`,
        parent_segment_id: chunks.length === 1 ? null : rootId,
        title: chunks.length === 1 ? segment.title : `${segment.title} (Part ${partIndex + 1})`,
        content,
        source_episode: segment.sourceEpisode,
        split_part: partIndex + 1,
        split_parts: chunks.length,
        char_count: content.length,
      });
    }
  }

  return expanded;
}

export function detectSourceStructureFromText(
  text: string,
  options: DetectSourceStructureOptions = {},
): SourceStructure {
  const maxCharsPerSegment = options.maxCharsPerSegment ?? DEFAULT_MAX_CHARS_PER_SEGMENT;
  const normalized = normalizeText(text);
  const selected = selectSegments(normalized, maxCharsPerSegment);
  const segments = expandSegments(selected.segments, maxCharsPerSegment);

  return {
    version: 1,
    strategy: selected.strategy,
    source_mode: selected.sourceMode,
    quality: {
      coverage_ratio: Number(computeCoverageRatio(selected.segments, normalized).toFixed(4)),
      continuity_ok: checkContinuity(selected.segments),
      min_segment_length: segments.length
        ? Math.min(...segments.map((segment) => segment.char_count))
        : 0,
      total_segments: segments.length,
    },
    segments,
  };
}

export async function detectSourceStructureProject(
  projectPath: string,
  options: DetectSourceStructureOptions = {},
): Promise<DetectSourceStructureProjectResult> {
  const resolvedProjectPath = path.resolve(projectPath);
  const sourcePath = path.join(resolvedProjectPath, "source.txt");
  const outputPath = path.join(resolvedProjectPath, "draft", "source-structure.json");
  const text = await fs.readFile(sourcePath, "utf-8");
  const structure = detectSourceStructureFromText(text, options);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(structure, null, 2)}\n`, "utf-8");

  return {
    project_path: resolvedProjectPath,
    source_path: sourcePath,
    output_path: outputPath,
    structure,
  };
}

export const detectSourceStructure = tool(
  "detect_source_structure",
  "Detect reusable source-native chapter or episode boundaries from <project>/source.txt and write draft/source-structure.json.",
  {
    project_path: z.string(),
    max_chars_per_segment: z.number().int().positive().optional(),
  },
  async ({ project_path: projectPath, max_chars_per_segment: maxCharsPerSegment }) => {
    const result = await detectSourceStructureProject(projectPath, {
      maxCharsPerSegment,
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);
