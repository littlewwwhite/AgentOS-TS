// apps/console/src/orchestrator.ts
import type { WsEvent } from "./types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function* runMock(message: string): AsyncGenerator<WsEvent> {
  yield { type: "text", text: "正在分析请求" };
  await sleep(200);
  yield { type: "text", text: `：「${message}」\n\n` };
  await sleep(300);

  yield {
    type: "tool_use",
    id: "mock_1",
    tool: "Read",
    input: { file_path: "workspace/c3/pipeline-state.json" },
  };
  await sleep(400);

  yield {
    type: "tool_result",
    id: "mock_1",
    tool: "Read",
    output: '{"current_stage":"VIDEO","stages":{}}',
    path: "workspace/c3/pipeline-state.json",
  };
  await sleep(200);

  yield { type: "text", text: "项目 **c3** 当前处于 VIDEO 阶段，EDITING 尚未开始。" };
  await sleep(100);

  yield { type: "result", exitCode: 0, duration: 1200 };
}

// 后续 Task 9 替换为真实 SDK，此文件不变
export const runAgent = runMock;
