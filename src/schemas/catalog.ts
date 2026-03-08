// input: Phase 1 novel analysis results
// output: Structured asset inventory (actors, locations, props)
// pos: Data contract between NTS Phase 1 and all downstream stages

import { z } from "zod";

export const BaseAssetSchema = z.object({
  id: z.string(), // "act_001", "loc_001", "prp_001"
  name: z.string(),
  states: z.array(z.string()).nullish(), // ["default", "战甲", "囚服"] — omit if only default
});
export type BaseAsset = z.infer<typeof BaseAssetSchema>;

export const CatalogSchema = z.object({
  actors: z.array(BaseAssetSchema),
  locations: z.array(BaseAssetSchema),
  props: z.array(BaseAssetSchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;
