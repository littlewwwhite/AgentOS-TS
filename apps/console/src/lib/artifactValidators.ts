export type ArtifactValidationResult = { ok: true } | { ok: false; error: string };
type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const LEGACY_DRAFT_STORYBOARD_RE = /^draft\/storyboard\/ep\d+\.shots\.json$/i;
const DRAFT_STORYBOARD_RE = /^output\/storyboard\/draft\/ep\d+_storyboard\.json$/i;
const APPROVED_STORYBOARD_RE = /^output\/storyboard\/approved\/ep\d+_storyboard\.json$/i;
const RUNTIME_STORYBOARD_RE = /^output\/ep\d+\/ep\d+_storyboard\.json$/i;

function ok(): ArtifactValidationResult {
  return { ok: true };
}

function fail(error: string): ArtifactValidationResult {
  return { ok: false, error };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asObject(value: unknown, label: string): ParseResult<Record<string, unknown>> {
  if (!isObject(value)) return { ok: false, error: `${label} must be an object` };
  return { ok: true, value };
}

function asArray(value: unknown, label: string): ParseResult<unknown[]> {
  if (!Array.isArray(value)) return { ok: false, error: `${label} must be an array` };
  return { ok: true, value };
}

function validateNamedCollection(
  value: unknown,
  label: string,
  requiredKeys: Array<"name">,
): ArtifactValidationResult {
  const items = asArray(value, label);
  if (!items.ok) return items;

  for (let index = 0; index < items.value.length; index += 1) {
    const item = asObject(items.value[index], `${label}[${index}]`);
    if (!item.ok) return item;
    for (const key of requiredKeys) {
      if (!isNonEmptyString(item.value[key])) {
        return fail(`${label}[${index}].${key} must be a non-empty string`);
      }
    }
    if ("states" in item.value && item.value.states !== undefined) {
      const states = asArray(item.value.states, `${label}[${index}].states`);
      if (!states.ok) return states;
      if (!states.value.every(isNonEmptyString)) {
        return fail(`${label}[${index}].states must contain only strings`);
      }
    }
  }

  return ok();
}

function validateDesign(data: unknown): ArtifactValidationResult {
  const object = asObject(data, "design.json");
  if (!object.ok) return object;

  if (!isNonEmptyString(object.value.title)) {
    return fail("design.json.title must be a non-empty string");
  }
  if (
    typeof object.value.total_episodes !== "number" ||
    !Number.isFinite(object.value.total_episodes) ||
    object.value.total_episodes <= 0
  ) {
    return fail("design.json.total_episodes must be a positive number");
  }
  const episodes = asArray(object.value.episodes, "design.json.episodes");
  if (!episodes.ok) return episodes;
  return ok();
}

function validateCatalog(data: unknown): ArtifactValidationResult {
  const object = asObject(data, "catalog.json");
  if (!object.ok) return object;

  const actors = validateNamedCollection(object.value.actors, "catalog.json.actors", ["name"]);
  if (!actors.ok) return actors;
  const locations = validateNamedCollection(object.value.locations, "catalog.json.locations", ["name"]);
  if (!locations.ok) return locations;
  const props = validateNamedCollection(object.value.props, "catalog.json.props", ["name"]);
  if (!props.ok) return props;
  return ok();
}

function validateScriptAction(action: unknown, label: string): ArtifactValidationResult {
  const object = asObject(action, label);
  if (!object.ok) return object;

  if (object.value.type !== "action" && object.value.type !== "dialogue") {
    return fail(`${label}.type must be "action" or "dialogue"`);
  }
  if (!isNonEmptyString(object.value.content)) {
    return fail(`${label}.content must be a non-empty string`);
  }
  if (object.value.type === "dialogue" && !isNonEmptyString(object.value.actor_id)) {
    return fail(`${label}.actor_id must be a non-empty string`);
  }
  return ok();
}

function validateScript(data: unknown): ArtifactValidationResult {
  const object = asObject(data, "script.json");
  if (!object.ok) return object;

  const episodes = asArray(object.value.episodes, "script.json.episodes");
  if (!episodes.ok) return episodes;

  for (let epIndex = 0; epIndex < episodes.value.length; epIndex += 1) {
    const episode = asObject(episodes.value[epIndex], `script.json.episodes[${epIndex}]`);
    if (!episode.ok) return episode;
    if (!isNonEmptyString(episode.value.episode_id)) {
      return fail(`script.json.episodes[${epIndex}].episode_id must be a non-empty string`);
    }
    if ("scenes" in episode.value && episode.value.scenes !== undefined) {
      const scenes = asArray(episode.value.scenes, `script.json.episodes[${epIndex}].scenes`);
      if (!scenes.ok) return scenes;
      for (let sceneIndex = 0; sceneIndex < scenes.value.length; sceneIndex += 1) {
        const scene = asObject(scenes.value[sceneIndex], `script.json.episodes[${epIndex}].scenes[${sceneIndex}]`);
        if (!scene.ok) return scene;
        if (!isNonEmptyString(scene.value.scene_id)) {
          return fail(`script.json.episodes[${epIndex}].scenes[${sceneIndex}].scene_id must be a non-empty string`);
        }
        if ("actions" in scene.value && scene.value.actions !== undefined) {
          const actions = asArray(scene.value.actions, `script.json.episodes[${epIndex}].scenes[${sceneIndex}].actions`);
          if (!actions.ok) return actions;
          for (let actionIndex = 0; actionIndex < actions.value.length; actionIndex += 1) {
            const actionResult = validateScriptAction(
              actions.value[actionIndex],
              `script.json.episodes[${epIndex}].scenes[${sceneIndex}].actions[${actionIndex}]`,
            );
            if (!actionResult.ok) return actionResult;
          }
        }
      }
    }
  }

  return ok();
}

function validateDraftShot(shot: unknown, label: string): ArtifactValidationResult {
  const object = asObject(shot, label);
  if (!object.ok) return object;
  if (!isNonEmptyString(object.value.prompt)) {
    return fail(`${label}.prompt must be a non-empty string`);
  }
  const sourceRefs = asArray(object.value.source_refs, `${label}.source_refs`);
  if (!sourceRefs.ok) return sourceRefs;
  if (!sourceRefs.value.every((value) => typeof value === "number" || isNonEmptyString(value))) {
    return fail(`${label}.source_refs must contain only strings or numbers`);
  }

  return ok();
}

function validateLegacyDraftStoryboard(data: unknown): ArtifactValidationResult {
  const object = asObject(data, "draft storyboard");
  if (!object.ok) return object;

  if (!isNonEmptyString(object.value.episode_id)) {
    return fail("draft storyboard.episode_id must be a non-empty string");
  }
  if (!isNonEmptyString(object.value.scene_id)) {
    return fail("draft storyboard.scene_id must be a non-empty string");
  }

  const shots = asArray(object.value.shots, "draft storyboard.shots");
  if (!shots.ok) return shots;

  for (let index = 0; index < shots.value.length; index += 1) {
    const shotResult = validateDraftShot(shots.value[index], `draft storyboard.shots[${index}]`);
    if (!shotResult.ok) return shotResult;
  }

  return ok();
}

function validateDraftStoryboard(data: unknown): ArtifactValidationResult {
  const object = asObject(data, "draft storyboard");
  if (!object.ok) return object;

  if (!isNonEmptyString(object.value.episode_id)) {
    return fail("draft storyboard.episode_id must be a non-empty string");
  }

  const scenes = asArray(object.value.scenes, "draft storyboard.scenes");
  if (!scenes.ok) return scenes;

  for (let sceneIndex = 0; sceneIndex < scenes.value.length; sceneIndex += 1) {
    const scene = asObject(scenes.value[sceneIndex], `draft storyboard.scenes[${sceneIndex}]`);
    if (!scene.ok) return scene;
    if (!isNonEmptyString(scene.value.scene_id)) {
      return fail(`draft storyboard.scenes[${sceneIndex}].scene_id must be a non-empty string`);
    }
    const shots = asArray(scene.value.shots, `draft storyboard.scenes[${sceneIndex}].shots`);
    if (!shots.ok) return shots;
    for (let shotIndex = 0; shotIndex < shots.value.length; shotIndex += 1) {
      const shotResult = validateDraftShot(
        shots.value[shotIndex],
        `draft storyboard.scenes[${sceneIndex}].shots[${shotIndex}]`,
      );
      if (!shotResult.ok) return shotResult;
    }
  }

  return ok();
}

function validateRuntimeShot(shot: unknown, label: string): ArtifactValidationResult {
  const object = asObject(shot, label);
  if (!object.ok) return object;

  if (!isNonEmptyString(object.value.shot_id)) {
    return fail(`${label}.shot_id must be a non-empty string`);
  }

  const hasPrompt =
    isNonEmptyString(object.value.partial_prompt) ||
    isNonEmptyString(object.value.partial_prompt_v2) ||
    isNonEmptyString(object.value.prompt) ||
    isNonEmptyString(object.value.complete_prompt) ||
    isNonEmptyString(object.value.complete_prompt_v2);

  if (!hasPrompt) {
    return fail(`${label} must contain at least one prompt field`);
  }

  return ok();
}

function validateRuntimeStoryboard(data: unknown): ArtifactValidationResult {
  const object = asObject(data, "storyboard");
  if (!object.ok) return object;

  if (!isNonEmptyString(object.value.episode_id)) {
    return fail("storyboard.episode_id must be a non-empty string");
  }

  const scenes = asArray(object.value.scenes, "storyboard.scenes");
  if (!scenes.ok) return scenes;

  for (let sceneIndex = 0; sceneIndex < scenes.value.length; sceneIndex += 1) {
    const scene = asObject(scenes.value[sceneIndex], `storyboard.scenes[${sceneIndex}]`);
    if (!scene.ok) return scene;
    if (!isNonEmptyString(scene.value.scene_id)) {
      return fail(`storyboard.scenes[${sceneIndex}].scene_id must be a non-empty string`);
    }
    const clips = asArray(scene.value.clips, `storyboard.scenes[${sceneIndex}].clips`);
    if (!clips.ok) return clips;
    for (let clipIndex = 0; clipIndex < clips.value.length; clipIndex += 1) {
      const clip = asObject(clips.value[clipIndex], `storyboard.scenes[${sceneIndex}].clips[${clipIndex}]`);
      if (!clip.ok) return clip;
      if (!isNonEmptyString(clip.value.clip_id)) {
        return fail(`storyboard.scenes[${sceneIndex}].clips[${clipIndex}].clip_id must be a non-empty string`);
      }
      const shots = asArray(clip.value.shots, `storyboard.scenes[${sceneIndex}].clips[${clipIndex}].shots`);
      if (!shots.ok) return shots;
      for (let shotIndex = 0; shotIndex < shots.value.length; shotIndex += 1) {
        const shotResult = validateRuntimeShot(
          shots.value[shotIndex],
          `storyboard.scenes[${sceneIndex}].clips[${clipIndex}].shots[${shotIndex}]`,
        );
        if (!shotResult.ok) return shotResult;
      }
    }
  }

  return ok();
}

export function validateEditableArtifact(path: string, data: unknown): ArtifactValidationResult {
  if (path === "draft/design.json") return validateDesign(data);
  if (path === "draft/catalog.json") return validateCatalog(data);
  if (path === "output/script.json") return validateScript(data);
  if (LEGACY_DRAFT_STORYBOARD_RE.test(path)) return validateLegacyDraftStoryboard(data);
  if (DRAFT_STORYBOARD_RE.test(path)) return validateDraftStoryboard(data);
  if (APPROVED_STORYBOARD_RE.test(path) || RUNTIME_STORYBOARD_RE.test(path)) return validateRuntimeStoryboard(data);
  return ok();
}
