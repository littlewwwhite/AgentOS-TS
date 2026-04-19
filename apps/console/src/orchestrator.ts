// apps/console/src/orchestrator.ts
import type { WsEvent } from "./types";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dirname, "../../..");

// ---------------------------------------------------------------------------
// Mock (kept as fallback / offline dev mode)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Real SDK implementation
// ---------------------------------------------------------------------------

export async function* runReal(
  message: string,
  project?: string,
  sessionId?: string,
): AsyncGenerator<WsEvent> {
  const cwd = project
    ? join(PROJECT_ROOT, "workspace", project)
    : PROJECT_ROOT;

  try {
    for await (const msg of query({
      prompt: message,
      options: {
        cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        ...(sessionId ? { resume: sessionId } : {}),
      },
    })) {
      const type = msg.type;

      if (type === "system") {
        const sys = msg as { subtype?: string; session_id?: string };
        if (sys.subtype === "init" && typeof sys.session_id === "string") {
          yield { type: "session", sessionId: sys.session_id };
        }
        yield { type: "system", subtype: sys.subtype ?? "unknown", data: msg };
        continue;
      }

      if (type === "assistant") {
        const content = (msg as { message?: { content?: unknown[] } }).message
          ?.content ?? [];

        for (const block of content as Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
        }>) {
          if (block.type === "text" && block.text) {
            for (const char of block.text) {
              yield { type: "text", text: char };
            }
          }
          if (block.type === "tool_use") {
            yield {
              type: "tool_use",
              id: block.id ?? "",
              tool: block.name ?? "",
              input: block.input,
            };
          }
        }
        continue;
      }

      if (type === "user") {
        const content = (msg as { message?: { content?: unknown[] } }).message
          ?.content ?? [];

        for (const block of content as Array<{
          type: string;
          tool_use_id?: string;
          content?: unknown;
        }>) {
          if (block.type === "tool_result") {
            const output =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
            yield {
              type: "tool_result",
              id: block.tool_use_id ?? "",
              tool: "",
              output,
              path: extractWorkspacePath(output),
            };
          }
        }
        continue;
      }

      if (type === "result") {
        const r = msg as {
          subtype?: string;
          duration_ms?: number;
          is_error?: boolean;
        };
        const isError = r.is_error === true || r.subtype !== "success";
        yield {
          type: "result",
          exitCode: isError ? 1 : 0,
          duration: r.duration_ms ?? 0,
        };
        continue;
      }

      yield { type: "system", subtype: String(type), data: msg };
    }
  } catch (err) {
    yield { type: "error", message: String(err) };
  }
}

/** Extract a workspace/output relative path from tool output text, if any. */
function extractWorkspacePath(content: string): string | undefined {
  const m = content.match(/(?:workspace|output)\/[^\s"']+/);
  return m?.[0];
}

// ---------------------------------------------------------------------------
// Active export — swap runMock → runReal here
// ---------------------------------------------------------------------------
export const runAgent = runReal;
