// input: Script scenes + Asset manifest
// output: Shot sequence and render jobs
// pos: Data contract for Stage3 (producer) output

import { z } from "zod";

export const ShotSchema = z.object({
  id: z.string(),
  scene_id: z.string(),
  episode: z.number().int().default(0),
  sequence: z.number().int(),
  description: z.string(),
  actor_ids: z.array(z.string()),
  asset_refs: z.array(z.string()),
  action_indexes: z.array(z.number().int()).default([]), // 0-based indexes into scene.actions[]
  camera: z.string().nullish(),
  duration: z.number().nullish(),
});
export type Shot = z.infer<typeof ShotSchema>;

export const RenderJobSchema = z.object({
  shot_id: z.string(),
  prompt: z.string(),
  assets: z.array(z.string()),
  status: z.string().default("pending"),
  output_path: z.string().nullish(),
});
export type RenderJob = z.infer<typeof RenderJobSchema>;

export const ProductionPlanSchema = z.object({
  project: z.string(),
  shots: z.array(ShotSchema),
  render_jobs: z.array(RenderJobSchema),
  metadata: z.record(z.unknown()).default({}),
});
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;
