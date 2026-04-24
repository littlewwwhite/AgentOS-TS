import type { WorkflowTone } from "./workflowStatus";

export function buildChatSuggestions(input: {
  hasProject: boolean;
  workflowTone?: WorkflowTone;
  currentStage?: string;
}): string[] {
  if (!input.hasProject) {
    return [
      "帮我新建项目并上传源文档",
      "创建一个新项目",
      "上传小说并初始化工作区",
    ];
  }

  if (input.workflowTone === "review") {
    return [
      `帮我审核当前${input.currentStage ?? ""}产物`.trim(),
      "打开待审核入口",
      "继续下一步",
    ];
  }

  if (input.workflowTone === "blocked") {
    return [
      "帮我处理返修请求",
      "告诉我先改哪里",
      "打开返修入口",
    ];
  }

  if (input.workflowTone === "stale") {
    return [
      "从失效阶段重新生成",
      "继续推进当前项目",
      "帮我恢复流程",
    ];
  }

  if (input.workflowTone === "error") {
    return [
      "帮我分析最近错误",
      "先定位阻塞原因",
      "告诉我现在该怎么恢复",
    ];
  }

  return [
    "继续推进当前项目",
    "告诉我下一步",
    "打开当前工作入口",
  ];
}
