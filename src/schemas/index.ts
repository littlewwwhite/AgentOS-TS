// input: All schema modules
// output: Unified schema registry keyed by workspace-relative file path
// pos: Central schema index for validation hooks and tools

import type { z } from "zod";

export { DesignSchema } from "./design.js";
export type { Design, EpisodeDesign, SceneSkeleton } from "./design.js";

export { CatalogSchema } from "./catalog.js";
export type { BaseAsset, Catalog } from "./catalog.js";

export { ScriptSchema } from "./script.js";
export type {
  Action,
  Actor,
  Episode,
  Environment,
  Location,
  Prop,
  Scene,
  SceneActorRef,
  SceneLocationRef,
  ScenePropRef,
  Script,
  State,
} from "./script.js";

export { AssetManifestSchema } from "./assets.js";
export type { ActorAsset, Asset, AssetManifest } from "./assets.js";

export { ProductionPlanSchema } from "./production.js";
export type { ProductionPlan, RenderJob, Shot } from "./production.js";

export { TimelineSchema } from "./timeline.js";
export type { Timeline, TimelineClip } from "./timeline.js";

export { SourceStructureSchema } from "./source-structure.js";
export type { SourceSegment, SourceStructure } from "./source-structure.js";

// --- Schema registry: workspace-relative path → Zod schema ---

import { DesignSchema } from "./design.js";
import { CatalogSchema } from "./catalog.js";
import { ScriptSchema } from "./script.js";
import { AssetManifestSchema } from "./assets.js";
import { ProductionPlanSchema } from "./production.js";
import { SourceStructureSchema } from "./source-structure.js";
import { TimelineSchema } from "./timeline.js";

export const schemaRegistry: Record<string, z.ZodType> = {
  "draft/source-structure.json": SourceStructureSchema,
  "design.json": DesignSchema,
  "catalog.json": CatalogSchema,
  "script.json": ScriptSchema,
  "assets/manifest.json": AssetManifestSchema,
  "production/plan.json": ProductionPlanSchema,
  "output/timeline.json": TimelineSchema,
};
