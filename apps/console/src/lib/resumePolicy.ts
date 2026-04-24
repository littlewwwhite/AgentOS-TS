import type { PipelineState, StageStatus } from "../types";
import { getEditPolicy } from "./editPolicy";
import { STAGE_ORDER, isStageName, isTerminalStageStatus } from "./workflowModel";

export type ResumeDecisionKind =
  | "review_required"
  | "revision_required"
  | "resume"
  | "complete";

export interface ResumeDecision {
  kind: ResumeDecisionKind;
  stage: string | null;
  action: "review" | "revise" | "retry" | "continue" | "regenerate" | "start" | "complete";
  label: string;
  reason: string;
  targetArtifact?: string;
}

function stageIndex(stage: string): number {
  const index = isStageName(stage) ? STAGE_ORDER.indexOf(stage) : -1;
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function statusRank(status: StageStatus): number {
  if (status === "change_requested") return 0;
  if (status === "in_review") return 1;
  if (status === "failed") return 2;
  if (status === "running" || status === "partial") return 3;
  if (status === "stale") return 4;
  if (status === "not_started") return 5;
  return 99;
}

function decisionForStage(stage: string, status: StageStatus): ResumeDecision | null {
  if (status === "change_requested") {
    return {
      kind: "revision_required",
      stage,
      action: "revise",
      label: `返修 ${stage}`,
      reason: `${stage} 有返修请求，必须先修订，不能继续使用旧下游产物。`,
    };
  }
  if (status === "in_review") {
    return {
      kind: "review_required",
      stage,
      action: "review",
      label: `审核 ${stage}`,
      reason: `${stage} 正在等待审核，通过或锁版前不应继续下游生成。`,
    };
  }
  if (status === "failed") {
    return {
      kind: "resume",
      stage,
      action: "retry",
      label: `重试 ${stage}`,
      reason: `${stage} 上次执行失败，应从该阶段重试。`,
    };
  }
  if (status === "running" || status === "partial") {
    return {
      kind: "resume",
      stage,
      action: "continue",
      label: `继续 ${stage}`,
      reason: `${stage} 尚未完成，应从该阶段继续。`,
    };
  }
  if (status === "stale") {
    return {
      kind: "resume",
      stage,
      action: "regenerate",
      label: `重新生成 ${stage}`,
      reason: `${stage} 已因上游变更失效，应从该阶段重新生成。`,
    };
  }
  if (status === "not_started") {
    return {
      kind: "resume",
      stage,
      action: "start",
      label: `开始 ${stage}`,
      reason: `${stage} 尚未开始，是当前最近可运行阶段。`,
    };
  }
  return null;
}

function decisionFromArtifact(path: string, status: StageStatus, reason?: string): ResumeDecision | null {
  const policy = getEditPolicy(path);
  if (!policy) return null;
  const decision = decisionForStage(policy.stage, status);
  if (!decision) return null;
  return {
    ...decision,
    targetArtifact: path,
    reason: reason ?? `${path} 当前为 ${status}，必须先处理该业务产物。`,
  };
}

function sortByStage<T extends { stage: string | null; status?: StageStatus }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const stageDiff = stageIndex(a.stage ?? "") - stageIndex(b.stage ?? "");
    if (stageDiff !== 0) return stageDiff;
    return statusRank(a.status ?? "not_started") - statusRank(b.status ?? "not_started");
  });
}

export function getResumeDecision(state: PipelineState): ResumeDecision {
  const openChange = (state.change_requests ?? []).find((request) => request.status === "open");
  if (openChange) {
    const decision = decisionFromArtifact(openChange.target_artifact, "change_requested", openChange.reason);
    if (decision) return decision;
  }

  const artifactDecisions = Object.entries(state.artifacts ?? {})
    .map(([path, artifact]) => ({
      ...decisionFromArtifact(path, artifact.status),
      status: artifact.status,
    }))
    .filter((decision): decision is ResumeDecision & { status: StageStatus } => !!decision.kind)
    .filter((decision) => decision.kind === "revision_required" || decision.kind === "review_required");

  const firstArtifactBlocker = sortByStage(artifactDecisions)[0];
  if (firstArtifactBlocker) return firstArtifactBlocker;

  for (const stageName of STAGE_ORDER) {
    const status = state.stages?.[stageName]?.status ?? "not_started";
    const decision = decisionForStage(stageName, status);
    if (decision) return decision;
    if (!isTerminalStageStatus(status)) break;
  }

  return {
    kind: "complete",
    stage: null,
    action: "complete",
    label: "流程完成",
    reason: "所有阶段均处于完成、审核通过或锁版状态。",
  };
}
