// input: pipeline state workbench queues
// output: decision-first production inbox for director/producer homepage
// pos: converts workflow state into actionable production priorities

import type { PipelineState } from "../types";
import { buildOverviewWorkbench, type WorkbenchItem } from "./overviewWorkbench";

export type ProductionInboxPriority = "decision" | "blocked";

export interface ProductionInboxItem extends WorkbenchItem {
  priority: ProductionInboxPriority;
  cta: string;
}

export interface ProductionInbox {
  primaryItems: ProductionInboxItem[];
  summary: {
    decisions: number;
    blocked: number;
    total: number;
  };
}

function toInboxItem(item: WorkbenchItem): ProductionInboxItem {
  if (item.kind === "review") {
    return { ...item, priority: "decision", cta: "去拍板" };
  }
  if (item.kind === "change_request") {
    return { ...item, priority: "blocked", cta: "去返修" };
  }
  return { ...item, priority: "blocked", cta: "重新生成" };
}

function priorityRank(priority: ProductionInboxPriority): number {
  return priority === "blocked" ? 0 : 1;
}

export function buildProductionInbox(state: PipelineState): ProductionInbox {
  const workbench = buildOverviewWorkbench(state);
  const primaryItems = [
    ...workbench.changeRequestItems,
    ...workbench.staleItems,
    ...workbench.reviewItems,
  ]
    .map(toInboxItem)
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));

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
