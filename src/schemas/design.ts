// input: Phase 1 novel analysis results
// output: Structured design blueprint (worldview + episode outline + visual style)
// pos: Data contract for NTS Phase 1 — unified design output

import { z } from "zod";

export const SceneSkeletonSchema = z.object({
  id: z.string(), // "1-1" format
  time: z.string(), // "日" | "夜" | ...
  setting: z.string(), // "内" | "外"
  location: z.string(),
  description: z.string(),
});
export type SceneSkeleton = z.infer<typeof SceneSkeletonSchema>;

export const EpisodeDesignSchema = z.object({
  episode: z.number().int(), // 1-indexed
  title: z.string(),
  main_plot: z.string(),
  climax: z.string(),
  cliffhanger: z.string(),
  scenes: z.array(SceneSkeletonSchema),
});
export type EpisodeDesign = z.infer<typeof EpisodeDesignSchema>;

export const DesignSchema = z.object({
  title: z.string(),
  worldview: z.string(), // free-text (only LLM consumes)
  style: z.string(), // visual direction
  total_episodes: z.number().int(),
  episodes: z.array(EpisodeDesignSchema),
});
export type Design = z.infer<typeof DesignSchema>;
