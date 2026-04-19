// input: project + optional SDK session_id → createSession()
// output: AgentSession with push(message), close(), events async-iterable
// pos: sole adapter between the WS layer and the Claude Agent SDK's streaming query

import type { WsEvent } from "./types";
import { query, type SDKUserMessage, type Query } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import { PushQueue } from "./lib/pushQueue";

const PROJECT_ROOT = join(import.meta.dirname, "../../..");

export interface AgentSession {
  push(message: string): void;
  close(): Promise<void>;
  events: AsyncIterable<WsEvent>;
  readonly projectKey: string | null;
}

function buildSDKUserMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

function extractWorkspacePath(content: string): string | undefined {
  const m = content.match(/(?:workspace|output)\/[^\s"']+/);
  return m?.[0];
}

// ---------------------------------------------------------------------------
// Real session — wraps SDK query() in streaming input mode
// ---------------------------------------------------------------------------

export function createSession(project?: string, resumeId?: string): AgentSession {
  const projectKey = project ?? null;
  const cwd = project ? join(PROJECT_ROOT, "workspace", project) : PROJECT_ROOT;

  const inputQueue = new PushQueue<SDKUserMessage>();
  const events = new PushQueue<WsEvent>();

  const sdkQuery: Query = query({
    prompt: inputQueue,
    options: {
      cwd,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      ...(resumeId ? { resume: resumeId } : {}),
    },
  });

  let textEmittedThisTurn = false;
  let closed = false;

  const pump = (async () => {
    try {
      for await (const msg of sdkQuery) {
        const type = msg.type;

        if (type === "system") {
          const sys = msg as { subtype?: string; session_id?: string };
          if (sys.subtype === "init" && typeof sys.session_id === "string") {
            events.push({ type: "session", sessionId: sys.session_id });
          }
          events.push({ type: "system", subtype: sys.subtype ?? "unknown", data: msg });
          continue;
        }

        if (type === "assistant") {
          const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
          for (const block of content as Array<{
            type: string;
            text?: string;
            id?: string;
            name?: string;
            input?: unknown;
          }>) {
            if (block.type === "text" && block.text) {
              textEmittedThisTurn = true;
              for (const ch of block.text) {
                events.push({ type: "text", text: ch });
              }
            }
            if (block.type === "tool_use") {
              events.push({
                type: "tool_use",
                id: block.id ?? "",
                tool: block.name ?? "",
                input: block.input,
              });
            }
          }
          continue;
        }

        if (type === "user") {
          const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
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
              events.push({
                type: "tool_result",
                id: block.tool_use_id ?? "",
                tool: "",
                output,
                path: extractWorkspacePath(output),
              });
            }
          }
          continue;
        }

        if (type === "result") {
          const r = msg as {
            subtype?: string;
            duration_ms?: number;
            is_error?: boolean;
            result?: string;
          };
          const isSuccess = r.subtype === "success" && r.is_error !== true;
          if (
            isSuccess &&
            typeof r.result === "string" &&
            r.result.length > 0 &&
            !textEmittedThisTurn
          ) {
            for (const ch of r.result) {
              events.push({ type: "text", text: ch });
            }
          }
          events.push({
            type: "result",
            exitCode: isSuccess ? 0 : 1,
            duration: r.duration_ms ?? 0,
          });
          textEmittedThisTurn = false;
          continue;
        }

        events.push({ type: "system", subtype: String(type), data: msg });
      }
    } catch (err) {
      if (!closed) {
        events.push({ type: "error", message: String(err) });
      }
    } finally {
      events.done();
    }
  })();

  return {
    projectKey,
    events,
    push(message: string) {
      if (closed) return;
      inputQueue.push(buildSDKUserMessage(message));
    },
    async close() {
      if (closed) return;
      closed = true;
      inputQueue.done();
      try {
        sdkQuery.close();
      } catch {
        // ignore
      }
      try {
        await pump;
      } catch {
        // already handled
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mock session — kept for offline / dev smoke; same shape as createSession
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createMockSession(project?: string): AgentSession {
  const events = new PushQueue<WsEvent>();
  let closed = false;
  let turn = 0;

  async function runTurn(message: string) {
    turn++;
    events.push({ type: "text", text: "正在分析请求" });
    await sleep(200);
    events.push({ type: "text", text: `：「${message}」\n\n` });
    await sleep(200);
    events.push({
      type: "tool_use",
      id: `mock_${turn}`,
      tool: "Read",
      input: { file_path: `workspace/${project ?? "demo"}/pipeline-state.json` },
    });
    await sleep(300);
    events.push({
      type: "tool_result",
      id: `mock_${turn}`,
      tool: "Read",
      output: '{"current_stage":"VIDEO","stages":{}}',
      path: `workspace/${project ?? "demo"}/pipeline-state.json`,
    });
    await sleep(200);
    events.push({ type: "text", text: `mock 回复 · turn ${turn}` });
    events.push({ type: "result", exitCode: 0, duration: 900 });
  }

  return {
    projectKey: project ?? null,
    events,
    push(message: string) {
      if (closed) return;
      void runTurn(message);
    },
    async close() {
      if (closed) return;
      closed = true;
      events.done();
    },
  };
}

// ---------------------------------------------------------------------------
// Active export — swap createMockSession → createSession here
// ---------------------------------------------------------------------------

export const createAgentSession = createSession;
