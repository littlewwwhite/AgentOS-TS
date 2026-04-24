import type {
  ArtifactKind,
  ArtifactState,
  EpisodeState,
  PipelineState,
  StageState,
  StageStatus,
} from "../types";

export type EditableContentKind = "json" | "text";

export interface EditPolicy {
  path: string;
  contentKind: EditableContentKind;
  stage: string;
  ownerRole: string;
  artifactKind: ArtifactKind;
  invalidateStages: string[];
  invalidateEpisodeKeys: Array<keyof EpisodeState>;
  episodeId?: string;
}

const APPROVED_STORYBOARD_RE = /^output\/storyboard\/approved\/(ep\d+)_storyboard\.json$/i;
const LEGACY_DRAFT_STORYBOARD_RE = /^draft\/storyboard\/(ep\d+)\.shots\.json$/i;
const DRAFT_STORYBOARD_RE = /^output\/storyboard\/draft\/(ep\d+)_storyboard\.json$/i;
const DRAFT_EPISODE_RE = /^draft\/episodes\/ep\d+\.md$/i;

function downstreamPostStages() {
  return ["VIDEO", "EDITING", "MUSIC", "SUBTITLE"];
}

export function getEditPolicy(relPath: string): EditPolicy | null {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");

  if (normalized === "source.txt") {
    return {
      path: normalized,
      contentKind: "text",
      stage: "SCRIPT",
      ownerRole: "writer",
      artifactKind: "source",
      invalidateStages: ["VISUAL", "STORYBOARD", ...downstreamPostStages()],
      invalidateEpisodeKeys: ["storyboard", "video", "editing", "music", "subtitle"],
    };
  }

  if (normalized === "draft/design.json") {
    return {
      path: normalized,
      contentKind: "json",
      stage: "SCRIPT",
      ownerRole: "writer",
      artifactKind: "source",
      invalidateStages: ["VISUAL", "STORYBOARD", ...downstreamPostStages()],
      invalidateEpisodeKeys: ["storyboard", "video", "editing", "music", "subtitle"],
    };
  }

  if (normalized === "draft/catalog.json") {
    return {
      path: normalized,
      contentKind: "json",
      stage: "SCRIPT",
      ownerRole: "writer",
      artifactKind: "source",
      invalidateStages: ["VISUAL", "STORYBOARD", ...downstreamPostStages()],
      invalidateEpisodeKeys: ["storyboard", "video", "editing", "music", "subtitle"],
    };
  }

  if (DRAFT_EPISODE_RE.test(normalized)) {
    return {
      path: normalized,
      contentKind: "text",
      stage: "SCRIPT",
      ownerRole: "writer",
      artifactKind: "source",
      invalidateStages: ["STORYBOARD", ...downstreamPostStages()],
      invalidateEpisodeKeys: ["storyboard", "video", "editing", "music", "subtitle"],
    };
  }

  if (normalized === "output/script.json") {
    return {
      path: normalized,
      contentKind: "json",
      stage: "SCRIPT",
      ownerRole: "writer",
      artifactKind: "canonical",
      invalidateStages: ["STORYBOARD", ...downstreamPostStages()],
      invalidateEpisodeKeys: ["storyboard", "video", "editing", "music", "subtitle"],
    };
  }

  const draftStoryboardMatch = normalized.match(DRAFT_STORYBOARD_RE) ?? normalized.match(LEGACY_DRAFT_STORYBOARD_RE);
  if (draftStoryboardMatch) {
    return {
      path: normalized,
      contentKind: "json",
      stage: "STORYBOARD",
      ownerRole: "director",
      artifactKind: "source",
      invalidateStages: downstreamPostStages(),
      invalidateEpisodeKeys: ["video", "editing", "music", "subtitle"],
      episodeId: draftStoryboardMatch[1].toLowerCase(),
    };
  }

  const approvedStoryboardMatch = normalized.match(APPROVED_STORYBOARD_RE);
  if (approvedStoryboardMatch) {
    return {
      path: normalized,
      contentKind: "json",
      stage: "STORYBOARD",
      ownerRole: "director",
      artifactKind: "canonical",
      invalidateStages: downstreamPostStages(),
      invalidateEpisodeKeys: ["video", "editing", "music", "subtitle"],
      episodeId: approvedStoryboardMatch[1].toLowerCase(),
    };
  }

  return null;
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function shouldMarkStale(status?: StageStatus): boolean {
  return !!status && status !== "not_started" && status !== "stale" && status !== "superseded";
}

function staleIfNeeded<T extends { status: StageStatus } | undefined>(node: T): T {
  if (!node || !shouldMarkStale(node.status)) return node;
  return { ...node, status: "stale" } as T;
}

function nextStageState(stage: StageState | undefined, ownerRole: string, ts: string): StageState {
  return {
    status: "in_review",
    artifacts: stage?.artifacts ?? [],
    updated_at: ts,
    notes: stage?.notes ?? null,
    owner_role: stage?.owner_role ?? ownerRole,
    revision: (stage?.revision ?? 0) + 1,
    locked: false,
  };
}

function nextArtifactState(
  existing: ArtifactState | undefined,
  policy: EditPolicy,
  ts: string,
): ArtifactState {
  return {
    kind: existing?.kind ?? policy.artifactKind,
    owner_role: existing?.owner_role ?? policy.ownerRole,
    status: "in_review",
    editable: existing?.editable ?? true,
    revision: (existing?.revision ?? 0) + 1,
    depends_on: existing?.depends_on ?? [],
    invalidates: existing?.invalidates ?? [],
    updated_at: ts,
    notes: existing?.notes ?? null,
  };
}

export function applyManualEditToPipelineState(
  state: PipelineState,
  relPath: string,
  now?: string,
): PipelineState {
  const policy = getEditPolicy(relPath);
  if (!policy) return state;

  const ts = nowIso(now);
  const next: PipelineState = {
    ...state,
    updated_at: ts,
    current_stage: policy.stage,
    next_action: `review ${policy.stage}`,
    stages: { ...state.stages },
    episodes: { ...state.episodes },
    artifacts: { ...(state.artifacts ?? {}) },
    change_requests: state.change_requests ? [...state.change_requests] : [],
  };

  next.stages[policy.stage] = nextStageState(next.stages[policy.stage], policy.ownerRole, ts);

  for (const stageName of policy.invalidateStages) {
    const stage = next.stages[stageName];
    if (!stage || !shouldMarkStale(stage.status)) continue;
    next.stages[stageName] = {
      ...stage,
      status: "stale",
      updated_at: ts,
      locked: false,
      notes: stage.notes ?? `invalidated by ${policy.path}`,
    };
  }

  next.artifacts![policy.path] = nextArtifactState(next.artifacts?.[policy.path], policy, ts);

  for (const invalidatedPath of next.artifacts![policy.path].invalidates) {
    const target = next.artifacts![invalidatedPath];
    if (!target || !shouldMarkStale(target.status)) continue;
    next.artifacts![invalidatedPath] = {
      ...target,
      status: "stale",
      updated_at: ts,
      notes: target.notes ?? `invalidated by ${policy.path}`,
    };
  }

  const episodeIds = policy.episodeId ? [policy.episodeId] : Object.keys(next.episodes);
  for (const episodeId of episodeIds) {
    const episode = next.episodes[episodeId];
    if (!episode) continue;
    const updatedEpisode: EpisodeState = { ...episode };

    if (policy.stage === "STORYBOARD") {
      updatedEpisode.storyboard = {
        status: "in_review",
        artifact: episode.storyboard?.artifact,
      };
    }

    for (const key of policy.invalidateEpisodeKeys) {
      updatedEpisode[key] = staleIfNeeded(updatedEpisode[key]);
    }

    next.episodes[episodeId] = updatedEpisode;
  }

  return next;
}
