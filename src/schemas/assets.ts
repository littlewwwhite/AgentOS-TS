// input: Actor/Scene/Prop references from Script
// output: Asset file paths and metadata
// pos: Data contract for Stage2 (asset_gen) output

import { z } from "zod";

export const AssetSchema = z.object({
  id: z.string(),
  type: z.string(),
  source_ref: z.string(),
  file_path: z.string(),
  metadata: z.record(z.string()).default({}),
});
export type Asset = z.infer<typeof AssetSchema>;

export const ActorAssetSchema = AssetSchema.extend({
  speech_style: z.string().nullish(),
});
export type ActorAsset = z.infer<typeof ActorAssetSchema>;

export const AssetManifestSchema = z.object({
  project: z.string(),
  actors: z.array(ActorAssetSchema),
  scenes: z.array(AssetSchema),
  props: z.array(AssetSchema),
});
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
