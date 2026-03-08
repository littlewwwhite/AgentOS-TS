// input: Video clips + audio tracks from render jobs
// output: Assembled timeline for final export
// pos: Data contract for Stage4 (post_prod) output

import { z } from "zod";

export const TimelineClipSchema = z.object({
  shot_id: z.string(),
  type: z.string(), // "video" | "audio_dialogue" | "audio_sfx" | "audio_music"
  file_path: z.string(),
  start_time: z.number(), // seconds from timeline start
  duration: z.number(),
  layer: z.number().int().default(0), // 0=base video, 1+=audio layers
});
export type TimelineClip = z.infer<typeof TimelineClipSchema>;

export const TimelineSchema = z.object({
  project: z.string(),
  episodes: z.array(z.number().int()),
  clips: z.array(TimelineClipSchema),
  total_duration: z.number(),
  metadata: z.record(z.unknown()).default({}),
});
export type Timeline = z.infer<typeof TimelineSchema>;
