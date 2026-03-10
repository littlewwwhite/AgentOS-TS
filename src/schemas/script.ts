// input: Any content source (novel, comic, game, original)
// output: Structured script data with unified State model (JSON-serializable pipeline IR)
// pos: Universal data contract between all Stage1 variants and all downstream stages

import { z } from "zod";

// --- Unified state (shared by actors, locations, props) ---

export const StateSchema = z.object({
  state_id: z.string(), // "st_001" (globally unique across all entity types)
  state_name: z.string(), // "casual", "ruins", "broken"
});
export type State = z.infer<typeof StateSchema>;

// --- Top-level entity registries ---

export const ActorSchema = z.object({
  actor_id: z.string(), // "act_001"
  actor_name: z.string(),
  states: z.array(StateSchema).default([]),
});
export type Actor = z.infer<typeof ActorSchema>;

export const LocationSchema = z.object({
  location_id: z.string(), // "loc_001"
  location_name: z.string(),
  states: z.array(StateSchema).default([]),
});
export type Location = z.infer<typeof LocationSchema>;

export const PropSchema = z.object({
  prop_id: z.string(), // "prp_001"
  prop_name: z.string(),
  states: z.array(StateSchema).default([]),
});
export type Prop = z.infer<typeof PropSchema>;

// --- Scene-level references (entity + optional state) ---

export const SceneActorRefSchema = z.object({
  actor_id: z.string(),
  state_id: z.string().nullish(),
});
export type SceneActorRef = z.infer<typeof SceneActorRefSchema>;

export const SceneLocationRefSchema = z.object({
  location_id: z.string(),
  state_id: z.string().nullish(),
});
export type SceneLocationRef = z.infer<typeof SceneLocationRefSchema>;

export const ScenePropRefSchema = z.object({
  prop_id: z.string(),
  state_id: z.string().nullish(),
});
export type ScenePropRef = z.infer<typeof ScenePropRefSchema>;

// --- Environment ---

export const EnvironmentSchema = z.object({
  space: z.string(), // "interior" | "exterior"
  time: z.string(), // "day" | "night" | "dawn" | "dusk" | "noon"
});
export type Environment = z.infer<typeof EnvironmentSchema>;

// --- Action (no sequence — array order is the order) ---

export const ActionSchema = z.object({
  type: z.string(), // dialogue | action | inner_thought | sfx
  content: z.string(),
  actor_id: z.string().nullish(), // null for scene-level (sfx, establishing)
  emotion: z.string().nullish(),
  direction: z.string().nullish(),
  beat: z.string().nullish(),
  time_hint: z.string().nullish(),
});
export type Action = z.infer<typeof ActionSchema>;

// --- Scene ---

export const SceneSchema = z.object({
  scene_id: z.string(), // "ep001_scn_001" (episode-prefixed, globally unique)
  environment: EnvironmentSchema,
  locations: z.array(SceneLocationRefSchema).default([]),
  actors: z.array(SceneActorRefSchema).default([]),
  props: z.array(ScenePropRefSchema).default([]),
  actions: z.array(ActionSchema).default([]),
});
export type Scene = z.infer<typeof SceneSchema>;

// --- Episode ---

export const EpisodeSchema = z.object({
  episode_id: z.string(), // "ep_001"
  title: z.string().nullish(),
  scenes: z.array(SceneSchema),
});
export type Episode = z.infer<typeof EpisodeSchema>;

// --- Script (top-level) ---

export const ScriptSchema = z.object({
  title: z.string(),
  worldview: z.string().nullish(),
  style: z.string().nullish(),
  actors: z.array(ActorSchema),
  locations: z.array(LocationSchema).default([]),
  props: z.array(PropSchema).default([]),
  episodes: z.array(EpisodeSchema),
});
export type Script = z.infer<typeof ScriptSchema>;
