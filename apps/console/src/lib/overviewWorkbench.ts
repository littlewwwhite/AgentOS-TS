import type { PipelineState, StageStatus } from "../types";
import { getEditPolicy } from "./editPolicy";
import { STAGE_ORDER, isStageName } from "./workflowModel";

export interface WorkbenchItem {
  key: string;
  kind: "review" | "change_request" | "stale";
  stage: string;
  title: string;
  reason: string;
  path?: string;
  status?: StageStatus;
}

function stageIndex(stage: string): number {
  const index = isStageName(stage) ? STAGE_ORDER.indexOf(stage) : -1;
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function compareWorkbenchItems(left: WorkbenchItem, right: WorkbenchItem): number {
  const stageDiff = stageIndex(left.stage) - stageIndex(right.stage);
  if (stageDiff !== 0) return stageDiff;
  return left.key.localeCompare(right.key);
}

function isWorkbenchItem(item: WorkbenchItem | null): item is WorkbenchItem {
  return item !== null;
}

function firstArtifactForStage(state: PipelineState, stage: string): string | undefined {
  const artifacts = state.stages?.[stage]?.artifacts ?? [];
  return artifacts[0];
}

export function buildOverviewWorkbench(state: PipelineState): {
  reviewItems: WorkbenchItem[];
  changeRequestItems: WorkbenchItem[];
  staleItems: WorkbenchItem[];
} {
  const reviewItems: WorkbenchItem[] = Object.entries(state.artifacts ?? {})
    .filter(([, artifact]) => artifact.status === "in_review")
    .map<WorkbenchItem | null>(([path]) => {
      const policy = getEditPolicy(path);
      if (!policy) return null;
      return {
        key: `review:${path}`,
        kind: "review" as const,
        stage: policy.stage,
        title: `审核 ${policy.stage}`,
        reason: `${path} 正在等待审核，通过前不应继续下游。`,
        path,
        status: "in_review" as const,
      };
    })
    .filter(isWorkbenchItem)
    .sort(compareWorkbenchItems);

  const changeRequestItems = (state.change_requests ?? [])
    .filter((request) => request.status === "open")
    .map((request) => {
      const policy = getEditPolicy(request.target_artifact);
      return {
        key: request.id,
        kind: "change_request" as const,
        stage: policy?.stage ?? "UNKNOWN",
        title: `返修 ${policy?.stage ?? "UNKNOWN"}`,
        reason: request.reason,
        path: request.target_artifact,
        status: "change_requested" as const,
      };
    })
    .sort(compareWorkbenchItems);

  const staleItems = Object.entries(state.stages ?? {})
    .filter(([stage, stageState]) => isStageName(stage) && stageState.status === "stale")
    .map(([stage]) => ({
      key: `stale:${stage}`,
      kind: "stale" as const,
      stage,
      title: `重新生成 ${stage}`,
      reason: `${stage} 已因上游变化失效，不能继续使用旧结果。`,
      path: firstArtifactForStage(state, stage),
      status: "stale" as const,
    }))
    .sort(compareWorkbenchItems);

  return { reviewItems, changeRequestItems, staleItems };
}
