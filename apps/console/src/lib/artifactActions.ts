import type { ArtifactState, ChangeRequest, PipelineState, StageState, StageStatus } from "../types";
import { getEditPolicy, type EditPolicy } from "./editPolicy";
import { approvedStoryboardPathFromAnyPath } from "./storyboardPaths";
import { isStageName, nextStageName } from "./workflowModel";

export type ArtifactAction = "approve" | "request_change" | "lock" | "unlock";

export interface ArtifactActionInput {
  action: ArtifactAction;
  reason?: string;
  requestedByRole?: string;
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function actionStatus(action: ArtifactAction): StageStatus {
  if (action === "approve") return "approved";
  if (action === "lock") return "locked";
  if (action === "request_change") return "change_requested";
  return "approved";
}

function nextActionLabel(action: ArtifactAction, stage: string): string {
  if (action === "request_change") return `revise ${stage}`;
  const next = isStageName(stage) ? nextStageName(stage) : null;
  return next ? `enter ${next}` : "complete";
}

function existingOrNewArtifact(
  existing: ArtifactState | undefined,
  policy: EditPolicy,
  status: StageStatus,
  ts: string,
): ArtifactState {
  return {
    kind: existing?.kind ?? policy.artifactKind,
    owner_role: existing?.owner_role ?? policy.ownerRole,
    status,
    editable: status === "locked" ? false : true,
    revision: existing?.revision ?? 0,
    depends_on: existing?.depends_on ?? [],
    invalidates: existing?.invalidates ?? [],
    updated_at: ts,
    notes: existing?.notes ?? null,
  };
}

function nextStageState(
  existing: StageState | undefined,
  policy: EditPolicy,
  status: StageStatus,
  ts: string,
): StageState {
  return {
    status,
    artifacts: unique([...(existing?.artifacts ?? []), policy.path]),
    updated_at: ts,
    notes: existing?.notes ?? null,
    owner_role: existing?.owner_role ?? policy.ownerRole,
    revision: existing?.revision ?? 0,
    locked: status === "locked" ? true : status === "approved" ? false : existing?.locked ?? false,
  };
}

function changeRequestId(ts: string, path: string): string {
  const stamp = ts.replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
  const pathKey = path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `cr_${stamp}_${pathKey}`;
}

function appendChangeRequest(
  current: ChangeRequest[] | undefined,
  policy: EditPolicy,
  input: ArtifactActionInput,
  ts: string,
): ChangeRequest[] {
  const request: ChangeRequest = {
    id: changeRequestId(ts, policy.path),
    target_artifact: policy.path,
    requested_by_role: input.requestedByRole ?? "producer",
    reason: input.reason ?? "manual change requested",
    created_at: ts,
    status: "open",
  };

  return [...(current ?? []), request];
}

export function applyArtifactActionToPipelineState(
  state: PipelineState,
  relPath: string,
  input: ArtifactActionInput,
  now?: string,
): PipelineState {
  const policy = getEditPolicy(relPath);
  if (!policy) {
    throw new Error("not a legal business artifact");
  }

  const ts = nowIso(now);
  const status = actionStatus(input.action);
  const next: PipelineState = {
    ...state,
    updated_at: ts,
    current_stage: policy.stage,
    next_action: nextActionLabel(input.action, policy.stage),
    stages: { ...state.stages },
    episodes: { ...state.episodes },
    artifacts: { ...(state.artifacts ?? {}) },
    change_requests: state.change_requests ? [...state.change_requests] : [],
  };

  next.stages[policy.stage] = nextStageState(next.stages[policy.stage], policy, status, ts);
  next.artifacts![policy.path] = existingOrNewArtifact(next.artifacts?.[policy.path], policy, status, ts);

  const approvedStoryboardPath =
    policy.stage === "STORYBOARD" && input.action === "approve"
      ? approvedStoryboardPathFromAnyPath(policy.path)
      : null;
  if (approvedStoryboardPath) {
    next.artifacts![approvedStoryboardPath] = {
      ...(next.artifacts?.[approvedStoryboardPath] ?? existingOrNewArtifact(undefined, policy, status, ts)),
      kind: "canonical",
      owner_role: policy.ownerRole,
      status,
      editable: true,
      updated_at: ts,
    };
  }

  if (input.action === "request_change") {
    next.change_requests = appendChangeRequest(next.change_requests, policy, input, ts);
  }

  if (policy.stage === "STORYBOARD" && policy.episodeId) {
    const episode = next.episodes[policy.episodeId];
    if (episode) {
      next.episodes[policy.episodeId] = {
        ...episode,
        storyboard: {
          status,
          artifact: approvedStoryboardPath ?? episode.storyboard?.artifact ?? policy.path,
        },
      };
    }
  }

  return next;
}
