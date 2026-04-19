// input:  parsed ScriptJson object (from script.json)
// output: FountainToken[] ordered stream + ref dict helpers
// pos:    pure utility — no imports, no side effects, no React/DOM/fetch

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export interface ScriptActor {
  actor_id: string;
  actor_name: string;
  description?: string;
  states?: ReadonlyArray<{ state_id: string; description: string }>;
}

export interface ScriptLocation {
  location_id: string;
  location_name: string;
  description?: string;
}

export interface ScriptProp {
  prop_id: string;
  prop_name: string;
  description?: string;
}

export type ScriptAction =
  | { type: "action"; content: string }
  | { type: "dialogue"; content: string; actor_id: string; emotion?: string };

export interface ScriptScene {
  scene_id: string;
  environment?: { space?: string; time?: string };
  locations?: ReadonlyArray<{ location_id: string; state_id?: string | null }>;
  actors?: ReadonlyArray<{ actor_id: string; state_id?: string | null }>;
  props?: ReadonlyArray<{ prop_id: string; state_id?: string | null }>;
  actions?: ReadonlyArray<ScriptAction>;
}

export interface ScriptEpisode {
  episode_id: string;
  title?: string | null;
  scenes?: ReadonlyArray<ScriptScene>;
}

export interface ScriptJson {
  title?: string | null;
  worldview?: string | null;
  style?: string | null;
  actors?: ReadonlyArray<ScriptActor>;
  locations?: ReadonlyArray<ScriptLocation>;
  props?: ReadonlyArray<ScriptProp>;
  episodes?: ReadonlyArray<ScriptEpisode>;
}

type RefRecord = {
  id?: string;
  name?: string;
  aliases?: ReadonlyArray<string>;
  actor_id?: string;
  actor_name?: string;
  location_id?: string;
  location_name?: string;
  prop_id?: string;
  prop_name?: string;
};

type RefSource = {
  actors?: ReadonlyArray<RefRecord>;
  locations?: ReadonlyArray<RefRecord>;
  props?: ReadonlyArray<RefRecord>;
};

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type FountainToken =
  | { kind: "title"; text: string }
  | { kind: "meta"; label: string; text: string }
  | {
      kind: "episode";
      epIndex: number;
      episodeId: string;
      title: string | null;
      editablePath: string;
    }
  | {
      kind: "scene_heading";
      epIndex: number;
      sceneIndex: number;
      scene: string;
      space: string | null;
      time: string | null;
      location: string | null;
      sceneId: string;
    }
  | {
      kind: "action";
      epIndex: number;
      sceneIndex: number;
      actionIndex: number;
      text: string;
      editablePath: string;
    }
  | {
      kind: "character";
      epIndex: number;
      sceneIndex: number;
      actionIndex: number;
      name: string;
      actorId: string;
    }
  | {
      kind: "paren";
      epIndex: number;
      sceneIndex: number;
      actionIndex: number;
      text: string;
      editablePath: string;
    }
  | {
      kind: "dialogue";
      epIndex: number;
      sceneIndex: number;
      actionIndex: number;
      text: string;
      actorId: string;
      editablePath: string;
    };

// ---------------------------------------------------------------------------
// buildRefDict
// ---------------------------------------------------------------------------

/**
 * Build a flat id→name map from actors, locations, and props.
 * e.g. dict["act_001"] === "白行风"
 * Missing fields are skipped silently; never throws.
 */
export function buildRefDict(script: RefSource): Record<string, string> {
  const dict: Record<string, string> = {};

  for (const actor of script.actors ?? []) {
    indexRef(dict, actor.actor_id ?? actor.id, actor.actor_name ?? actor.name, actor.aliases);
  }

  for (const loc of script.locations ?? []) {
    indexRef(dict, loc.location_id ?? loc.id, loc.location_name ?? loc.name, loc.aliases);
  }

  for (const prop of script.props ?? []) {
    indexRef(dict, prop.prop_id ?? prop.id, prop.prop_name ?? prop.name, prop.aliases);
  }

  return dict;
}

function indexRef(
  dict: Record<string, string>,
  id: string | undefined,
  name: string | undefined,
  aliases: ReadonlyArray<string> | undefined,
) {
  if (!name) return;
  if (id) dict[id] = name;
  dict[name] = name;
  for (const alias of aliases ?? []) {
    if (alias) dict[alias] = name;
  }
}

// ---------------------------------------------------------------------------
// resolveRefs
// ---------------------------------------------------------------------------

const REF_PATTERN = /\{\{([^{}\n]+)\}\}|\{([^{}\n]+)\}/g;
const ID_REF_PATTERN = /^(act|loc|prp|st)_[A-Za-z0-9_]+$/;
const HUMAN_NAME_PATTERN = /[\u3400-\u9fff]/;

/**
 * Replace {act_XXX} / {loc_XXX} / {prp_XXX} tokens in text with their
 * human-readable names from dict. Unknown tokens are left as-is.
 */
export function resolveRefs(
  text: string,
  dict: Record<string, string>,
): string {
  return text.replace(REF_PATTERN, (match, doubleKey: string | undefined, singleKey: string | undefined) => {
    const key = (doubleKey ?? singleKey ?? "").trim();
    if (!key) return match;
    if (dict[key]) return dict[key];
    if (!ID_REF_PATTERN.test(key) && HUMAN_NAME_PATTERN.test(key)) return key;
    return match;
  });
}

// ---------------------------------------------------------------------------
// buildFountainTokens — internal helpers
// ---------------------------------------------------------------------------

function spaceCode(space: string | undefined): string | null {
  if (!space) return null;
  if (space === "interior") return "INT";
  if (space === "exterior") return "EXT";
  return space.toUpperCase();
}

function timeCode(time: string | undefined): string | null {
  if (!time) return null;
  return time.toUpperCase();
}

function buildSceneHeadingText(
  spaceStr: string | null,
  locationName: string | null,
  timeStr: string | null,
): string {
  const parts: string[] = [];
  if (spaceStr) parts.push(spaceStr);
  if (locationName) parts.push(locationName);
  const prefix = parts.join(". ");
  if (timeStr) return prefix ? `${prefix} — ${timeStr}` : timeStr;
  return prefix;
}

// ---------------------------------------------------------------------------
// buildFountainTokens
// ---------------------------------------------------------------------------

/**
 * Convert a parsed script.json into an ordered flat array of FountainTokens.
 * Pure: same input → same output; no side effects.
 */
export function buildFountainTokens(script: ScriptJson): FountainToken[] {
  const tokens: FountainToken[] = [];
  const dict = buildRefDict(script);

  // title
  if (script.title) {
    tokens.push({ kind: "title", text: script.title });
  }

  // meta
  if (script.worldview) {
    tokens.push({ kind: "meta", label: "worldview", text: script.worldview });
  }
  if (script.style) {
    tokens.push({ kind: "meta", label: "style", text: script.style });
  }

  // episodes
  const episodes = script.episodes ?? [];
  for (let epIndex = 0; epIndex < episodes.length; epIndex++) {
    const episode = episodes[epIndex];

    tokens.push({
      kind: "episode",
      epIndex,
      episodeId: episode.episode_id,
      title: episode.title ?? null,
      editablePath: `episodes.${epIndex}.title`,
    });

    const scenes = episode.scenes ?? [];
    for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
      const scene = scenes[sceneIndex];

      // scene heading
      const env = scene.environment;
      const spaceStr = spaceCode(env?.space);
      const timeStr = timeCode(env?.time);

      const firstLocRef = scene.locations?.[0];
      const locationName = firstLocRef
        ? (dict[firstLocRef.location_id] ?? null)
        : null;

      const headingText = buildSceneHeadingText(
        spaceStr,
        locationName,
        timeStr,
      );

      tokens.push({
        kind: "scene_heading",
        epIndex,
        sceneIndex,
        scene: headingText,
        space: spaceStr,
        time: timeStr,
        location: locationName,
        sceneId: scene.scene_id,
      });

      // actions
      const actions = scene.actions ?? [];
      for (
        let actionIndex = 0;
        actionIndex < actions.length;
        actionIndex++
      ) {
        const action = actions[actionIndex];
        const basePath = `episodes.${epIndex}.scenes.${sceneIndex}.actions.${actionIndex}`;

        if (action.type === "action") {
          tokens.push({
            kind: "action",
            epIndex,
            sceneIndex,
            actionIndex,
            text: resolveRefs(action.content, dict),
            editablePath: `${basePath}.content`,
          });
        } else if (action.type === "dialogue") {
          // character
          tokens.push({
            kind: "character",
            epIndex,
            sceneIndex,
            actionIndex,
            name: dict[action.actor_id] ?? action.actor_id,
            actorId: action.actor_id,
          });

          // paren (emotion)
          if (action.emotion) {
            tokens.push({
              kind: "paren",
              epIndex,
              sceneIndex,
              actionIndex,
              text: action.emotion,
              editablePath: `${basePath}.emotion`,
            });
          }

          // dialogue
          tokens.push({
            kind: "dialogue",
            epIndex,
            sceneIndex,
            actionIndex,
            text: resolveRefs(action.content, dict),
            actorId: action.actor_id,
            editablePath: `${basePath}.content`,
          });
        }
        // unknown action types: skip silently
      }
    }
  }

  return tokens;
}
