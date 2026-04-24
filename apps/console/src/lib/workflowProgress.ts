import type { StageStatus } from "../types";
import { MVP_STAGE_ORDER } from "./workflowModel";

export interface WorkflowProgressItem {
  key: (typeof MVP_STAGE_ORDER)[number];
  label: string;
  state: "done" | "current" | "blocked" | "idle";
}

function labelFor(stage: WorkflowProgressItem["key"]): string {
  switch (stage) {
    case "SCRIPT": return "剧本";
    case "VISUAL": return "素材";
    case "STORYBOARD": return "分镜";
    case "VIDEO": return "视频";
  }
}

function visualState(status?: string): WorkflowProgressItem["state"] {
  if (!status || status === "not_started") return "idle";
  if (status === "failed" || status === "stale" || status === "change_requested") return "blocked";
  if (status === "approved" || status === "locked" || status === "completed" || status === "validated") return "done";
  return "idle";
}

export function buildWorkflowProgress(input: {
  currentStage: string;
  stageStatuses: Record<string, StageStatus | undefined>;
}): WorkflowProgressItem[] {
  return MVP_STAGE_ORDER.map((stage) => ({
    key: stage,
    label: labelFor(stage),
    state: stage === input.currentStage ? "current" : visualState(input.stageStatuses[stage]),
  }));
}
