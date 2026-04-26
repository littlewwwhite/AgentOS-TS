// input: pipeline state workbench queues
// output: decision-first production inbox for director/producer homepage
// pos: converts workflow state into actionable production priorities

import type { PipelineState } from "../types";
import { buildOverviewWorkbench, type WorkbenchItem } from "./overviewWorkbench";
import { STAGE_ORDER, isStageName } from "./workflowModel";

export type ProductionInboxPriority = "decision" | "blocked";
export type ProductionInboxCta = "去拍板" | "去返修" | "重新生成";

export interface ProductionInboxItem extends WorkbenchItem {
  priority: ProductionInboxPriority;
  cta: ProductionInboxCta;
}

export interface ProductionInbox {
  primaryItems: ProductionInboxItem[];
  summary: {
    decisions: number;
    blocked: number;
    total: number;
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench item kind: ${String(value)}`);
}

function toInboxItem(item: WorkbenchItem): ProductionInboxItem {
  switch (item.kind) {
    case "review":
      return { ...item, priority: "decision", cta: "去拍板" };
    case "change_request":
      return { ...item, priority: "blocked", cta: "去返修" };
    case "stale":
      return { ...item, priority: "blocked", cta: "重新生成" };
    default:
      return assertNever(item.kind);
  }
}

function priorityRank(priority: ProductionInboxPriority): number {
  return priority === "blocked" ? 0 : 1;
}

function stageRank(stage: string): number {
  const index = isStageName(stage) ? STAGE_ORDER.indexOf(stage) : -1;
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function compareInboxItems(left: ProductionInboxItem, right: ProductionInboxItem): number {
  const priorityDiff = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDiff !== 0) return priorityDiff;

  const stageDiff = stageRank(left.stage) - stageRank(right.stage);
  if (stageDiff !== 0) return stageDiff;

  return left.key.localeCompare(right.key);
}

export function buildProductionInbox(state: PipelineState): ProductionInbox {
  const workbench = buildOverviewWorkbench(state);
  const primaryItems = [
    ...workbench.changeRequestItems,
    ...workbench.staleItems,
    ...workbench.reviewItems,
  ]
    .map(toInboxItem)
    .sort(compareInboxItems);

  const decisions = primaryItems.filter((item) => item.priority === "decision").length;
  const blocked = primaryItems.filter((item) => item.priority === "blocked").length;
  return {
    primaryItems,
    summary: {
      decisions,
      blocked,
      total: primaryItems.length,
    },
  };
}
