// input: Deterministic source segmentation metadata from source detector
// output: Structured source boundary contract for prompt stages
// pos: Phase 1 draft-only contract between source detector and script-adapt prompts

import { z } from "zod";

export const SourceSegmentSchema = z.object({
  segment_id: z.string(),
  parent_segment_id: z.string().nullable(),
  title: z.string(),
  content: z.string(),
  source_episode: z.number().int().nullable(),
  split_part: z.number().int().positive(),
  split_parts: z.number().int().positive(),
  char_count: z.number().int().nonnegative(),
});
export type SourceSegment = z.infer<typeof SourceSegmentSchema>;

export const SourceStructureSchema = z.object({
  version: z.literal(1),
  strategy: z.enum([
    "explicit_markers",
    "numbered_titles",
    "standalone_numbers",
    "scene_markers",
    "chunk_fallback",
  ]),
  source_mode: z.enum(["authoritative_segments", "fallback_chunks"]),
  quality: z.object({
    coverage_ratio: z.number().min(0),
    continuity_ok: z.boolean(),
    min_segment_length: z.number().int().nonnegative(),
    total_segments: z.number().int().nonnegative(),
  }),
  segments: z.array(SourceSegmentSchema),
});
export type SourceStructure = z.infer<typeof SourceStructureSchema>;
