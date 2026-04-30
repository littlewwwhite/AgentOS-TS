// input: project + optional SDK session_id → createSession()
// output: AgentSession with push(message), close(), events async-iterable
// pos: sole adapter between the WS layer and the Claude Agent SDK's streaming query

import type { WsEvent } from "./types";
import {
  query,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import { PushQueue } from "./lib/pushQueue";
import { loadEnvFileIfMissing } from "./lib/serverEnv";
import { buildAgentHooks } from "./lib/agentHooks";

const PROJECT_ROOT = join(import.meta.dirname, "../../..");
loadEnvFileIfMissing(join(PROJECT_ROOT, ".env"));

export interface AgentSession {
  push(message: string): void;
  interrupt(): Promise<void>;
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function sdkResumeId(resumeId?: string): string | undefined {
  if (!resumeId || resumeId.startsWith("messages_")) return undefined;
  return resumeId;
}

export function buildAgentSystemPrompt(project?: string | null): string {
  return [
    "You are the AgentOS Console runtime for an AI video production pipeline.",
    "Respond in Simplified Chinese. Keep code, file paths, JSON keys, and command names in English.",
    `Active project: ${project ?? "none"}.`,
    `Repository root: ${PROJECT_ROOT}.`,
    project
      ? `Current project workspace: ${join(PROJECT_ROOT, "workspace", project)}.`
      : "Current project workspace: none.",
    "Before answering operational questions, read and follow the repository CLAUDE.md contract.",
    "For project execution state, read pipeline-state.json in the current project workspace first.",
    "Before answering progress or next-step questions, you must call Read on pipeline-state.json.",
    "Never ask the user to paste pipeline-state.json; the SDK session has local Read access.",
    "If pipeline-state.json exists, do not report every stage as pending confirmation.",
    "Default to continuing from current_stage and next_action unless pipeline-state.json explicitly blocks progress.",
    "Do not end operational replies by asking whether to continue when next_action is known.",
    "For status-only questions, report the concise next action instead of asking a confirmation question.",
    "AgentOS pipeline: SCRIPT -> VISUAL -> STORYBOARD -> VIDEO -> EDITING -> MUSIC -> SUBTITLE.",
    "If the user says start/continue/next/开始执行/继续/下一步, inspect pipeline-state.json, source.txt, and output/ before deciding the next stage.",
    "Never invent external CG/Maya/Deadline/Houdini/Nuke production pipelines.",
    "Do not claim you have no access to the local pipeline when running through Claude Agent SDK tools; use the available file and command tools.",
  ].join("\n");
}

export function buildSdkQueryOptions(projectKey: string | null, cwd: string, resumeId?: string) {
  const resume = sdkResumeId(resumeId);
  const hooks = buildAgentHooks(projectKey ? cwd : null);
  return {
    cwd,
    model: process.env.ANTHROPIC_MODEL,
    env: process.env,
    systemPrompt: {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: buildAgentSystemPrompt(projectKey),
    },
    tools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
    allowedTools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"],
    mcpServers: {},
    strictMcpConfig: true,
    plugins: [],
    settingSources: [],
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    thinking: { type: "adaptive" as const },
    settings: {
      showThinkingSummaries: true,
      alwaysThinkingEnabled: true,
    },
    ...(hooks ? { hooks } : {}),
    ...(resume ? { resume } : {}),
  };
}

export { buildAgentHooks };

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
    options: buildSdkQueryOptions(projectKey, cwd, resumeId),
  });

  let textEmittedThisTurn = false;
  let thinkingEmittedThisTurn = false;
  let closed = false;

  const pump = (async () => {
    try {
      for await (const msg of sdkQuery) {
        const type = msg.type;

        if (type === "system") {
          const sys = msg as {
            subtype?: string;
            session_id?: string;
            slash_commands?: unknown;
            content?: unknown;
          };
          if (sys.subtype === "init" && typeof sys.session_id === "string") {
            events.push({ type: "session", sessionId: sys.session_id });
            const commands = stringArray(sys.slash_commands);
            if (commands.length > 0) {
              events.push({ type: "slash_commands", commands });
            }
          }
          if (sys.subtype === "local_command_output" && typeof sys.content === "string" && sys.content.length > 0) {
            textEmittedThisTurn = true;
            events.push({ type: "text", text: sys.content });
          }
          events.push({ type: "system", subtype: sys.subtype ?? "unknown", data: msg });
          continue;
        }

        if (type === "stream_event") {
          // Token-level partial updates when includePartialMessages=true.
          // Shape: { type: 'stream_event', event: BetaRawMessageStreamEvent }
          const ev = (msg as {
            event?: {
              type?: string;
              content_block?: { type?: string; thinking?: string };
              delta?: { type?: string; text?: string; thinking?: string };
            };
          }).event;
          if (
            ev?.type === "content_block_start" &&
            ev.content_block?.type === "thinking" &&
            typeof ev.content_block.thinking === "string" &&
            ev.content_block.thinking.length > 0
          ) {
            thinkingEmittedThisTurn = true;
            events.push({ type: "thinking", text: ev.content_block.thinking });
          }
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
            textEmittedThisTurn = true;
            events.push({ type: "text", text: ev.delta.text });
          }
          if (ev?.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && typeof ev.delta.thinking === "string") {
            thinkingEmittedThisTurn = true;
            events.push({ type: "thinking", text: ev.delta.thinking });
          }
          continue;
        }

        if (type === "assistant") {
          // Final per-turn snapshot. Text was already streamed via stream_event,
          // so only emit text here as a fallback when partial streaming didn't fire
          // (defensive — shouldn't normally happen with includePartialMessages=true).
          const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
          for (const block of content as Array<{
            type: string;
            text?: string;
            thinking?: string;
            id?: string;
            name?: string;
            input?: unknown;
          }>) {
            if (block.type === "thinking" && block.thinking && !thinkingEmittedThisTurn) {
              thinkingEmittedThisTurn = true;
              events.push({ type: "thinking", text: block.thinking });
            }
            if (block.type === "text" && block.text && !textEmittedThisTurn) {
              textEmittedThisTurn = true;
              events.push({ type: "text", text: block.text });
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
            // Final-reply fallback — emit as a single text event. Happens only
            // when neither stream_event nor assistant-block text surfaced
            // (e.g., pre-partial-message SDK behavior or empty-text corner cases).
            events.push({ type: "text", text: r.result });
          }
          events.push({
            type: "result",
            exitCode: isSuccess ? 0 : 1,
            duration: r.duration_ms ?? 0,
          });
          textEmittedThisTurn = false;
          thinkingEmittedThisTurn = false;
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
    async interrupt() {
      if (closed) return;
      await sdkQuery.interrupt();
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
    async interrupt() {
      events.push({ type: "result", exitCode: 130, duration: 0 });
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

export function createAgentSession(project?: string, resumeId?: string): AgentSession {
  return createSession(project, resumeId);
}
