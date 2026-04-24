import type { PipelineState } from "../types";
import { getResumeDecision } from "./resumePolicy";
import { buildOverviewWorkbench } from "./overviewWorkbench";
import { STAGE_ORDER } from "./workflowModel";

export type WorkflowTone = "error" | "blocked" | "review" | "stale" | "running" | "ready" | "complete";

export interface WorkflowStatus {
  tone: WorkflowTone;
  title: string;
  currentStage: string;
  nextStep: string;
  explanation: string;
  counts: {
    review: number;
    changeRequest: number;
    stale: number;
  };
}

function anyStageRunning(state: PipelineState): boolean {
  return STAGE_ORDER.some((stage) => state.stages?.[stage]?.status === "running");
}

export function buildWorkflowStatus(state: PipelineState): WorkflowStatus {
  const decision = getResumeDecision(state);
  const workbench = buildOverviewWorkbench(state);
  const counts = {
    review: workbench.reviewItems.length,
    changeRequest: workbench.changeRequestItems.length,
    stale: workbench.staleItems.length,
  };
  const currentStage = state.current_stage ?? "—";

  if (state.last_error) {
    return {
      tone: "error",
      title: "流程异常",
      currentStage,
      nextStep: "先处理最近错误，再继续下游。",
      explanation: state.last_error,
      counts,
    };
  }

  if (counts.changeRequest > 0) {
    return {
      tone: "blocked",
      title: "需要返修",
      currentStage,
      nextStep: "先处理返修队列，通过后再继续生成。",
      explanation: "有业务角色提出修改意见，后续产物不能继续被当成最终版本使用。",
      counts,
    };
  }

  if (counts.review > 0) {
    return {
      tone: "review",
      title: "等待审核",
      currentStage,
      nextStep: "先审核待审核产物，通过或返修后再继续。",
      explanation: "当前处于正常流程中，但下游生成必须等上游关键产物确认。",
      counts,
    };
  }

  if (counts.stale > 0) {
    return {
      tone: "stale",
      title: "需要重新生成",
      currentStage,
      nextStep: "从最早失效阶段重新生成，避免使用旧结果。",
      explanation: "上游内容发生变化，部分下游产物已经不再可信。",
      counts,
    };
  }

  if (anyStageRunning(state)) {
    return {
      tone: "running",
      title: "正在运行",
      currentStage,
      nextStep: state.next_action ?? decision.label,
      explanation: "Agent 正在推进当前阶段，等待结果落盘后再审核。",
      counts,
    };
  }

  if (decision.action === "complete") {
    return {
      tone: "complete",
      title: "流程完成",
      currentStage,
      nextStep: "可以交付、导出，或从任意合法产物发起修改。",
      explanation: decision.reason,
      counts,
    };
  }

  return {
    tone: "ready",
    title: "可以继续",
    currentStage,
    nextStep: decision.label,
    explanation: decision.reason,
    counts,
  };
}
