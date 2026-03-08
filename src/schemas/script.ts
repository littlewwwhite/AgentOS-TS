// input: Any content source (novel, comic, game, original)
// output: Structured script data with Actor/ActorState tree (JSON-serializable pipeline IR)
// pos: Universal data contract between all Stage1 variants and all downstream stages

import { z } from "zod";

export const ActorStateSchema = z.object({
  id: z.string(), // "st_001" (globally unique)
  name: z.string(), // "casual", "work", "wedding"
});
export type ActorState = z.infer<typeof ActorStateSchema>;

export const LocationStateSchema = z.object({
  id: z.string(), // "lst_001" (globally unique)
  name: z.string(), // "ruins", "activated", "intact"
});
export type LocationState = z.infer<typeof LocationStateSchema>;

export const ActorSchema = z.object({
  id: z.string(), // "act_001"
  name: z.string(),
  states: z.array(ActorStateSchema).default([]),
});
export type Actor = z.infer<typeof ActorSchema>;

export const LocationSchema = z.object({
  id: z.string(), // "loc_001"
  name: z.string(),
  states: z.array(LocationStateSchema).default([]),
});
export type Location = z.infer<typeof LocationSchema>;

export const PropSchema = z.object({
  id: z.string(), // "prp_001"
  name: z.string(),
  description: z.string().nullish(),
});
export type Prop = z.infer<typeof PropSchema>;

export const ActionSchema = z.object({
  sequence: z.number().int(), // order within scene, 1-indexed
  actor_id: z.string().nullish(), // null for scene-level (sfx, establishing)
  type: z.string(), // dialogue | action | voiceover | inner_thought | narration | sfx
  content: z.string(),
  emotion: z.string().nullish(),
  direction: z.string().nullish(),
  beat: z.string().nullish(),
  time_hint: z.string().nullish(),
});
export type Action = z.infer<typeof ActionSchema>;

export const CastMemberSchema = z.object({
  actor_id: z.string(), // "act_001"
  state_id: z.string().nullish(), // null = default state
});
export type CastMember = z.infer<typeof CastMemberSchema>;

export const SceneSchema = z.object({
  id: z.string(), // "scn_001"
  sequence: z.number().int(),
  location: z.string(),
  location_id: z.string().nullish(),
  location_state_id: z.string().nullish(),
  time_of_day: z.string().nullish(),
  summary: z.string().default(""),
  cast: z.array(CastMemberSchema).default([]),
  prop_ids: z.array(z.string()).default([]),
  actions: z.array(ActionSchema).default([]),
  environment: z.string().nullish(),
  metadata: z.record(z.unknown()).default({}),
});
export type Scene = z.infer<typeof SceneSchema>;

export const EpisodeSchema = z.object({
  episode: z.number().int(), // 1-indexed
  title: z.string().nullish(),
  summary: z.string().nullish(),
  scenes: z.array(SceneSchema),
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const ScriptSchema = z.object({
  title: z.string(),
  description: z.string().nullish(),
  worldview: z.string().nullish(),
  style: z.string().nullish(),
  actors: z.array(ActorSchema),
  locations: z.array(LocationSchema).default([]),
  props: z.array(PropSchema).default([]),
  episodes: z.array(EpisodeSchema),
  metadata: z.record(z.unknown()).default({}),
});
export type Script = z.infer<typeof ScriptSchema>;
