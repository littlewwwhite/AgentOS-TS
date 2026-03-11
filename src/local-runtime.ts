// input: SDK query() call, streaming SDK messages
// output: Streamed events forwarded via protocol.emit()
// pos: Host-side query executor — wraps SDK query() with env isolation and stream fan-out

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { emit } from "./protocol.js";
import type { TodoItem } from "./protocol.js";

// ---------- Types ----------

export interface RuntimeQueryOptions {
  prompt: string;
  options: Record<string, unknown>;
  /** Undefined = main session; agent name otherwise */
  agentField?: string;
  requestId?: string;
  /** Mutable result bag — caller fills session_id from result message */
  resultBag: {
    sessionId: string | null;
    cost: number;
    durationMs: number;
    isError: boolean;
  };
  /** Called immediately when a result message arrives (before loop exits) */
  onResult?: (sessionId: string) => void;
}

export interface RuntimeQueryHandle {
  query: Query;
  /** Resolves when the stream is fully consumed or aborted */
  done: Promise<void>;
}

// ---------- runQuery ----------

/**
 * Execute a single SDK query() on the host machine.
 *
 * Callers MUST ensure `delete process.env.CLAUDECODE` has been called at
 * process startup before invoking this — otherwise the SDK detects a nested
 * Claude Code context and misbehaves.
 *
 * Returns a handle so the caller can call handle.query.close() to abort.
 */
export function runQuery(opts: RuntimeQueryOptions): RuntimeQueryHandle {
  const { prompt, agentField, requestId } = opts;
  const t0 = Date.now();

  const q = query({
    prompt,
    options: {
      ...opts.options,
      includePartialMessages: true,
      stderr: (data: string) => {
        const trimmed = data.trim();
        if (trimmed) {
          emit({
            type: "error",
            message: `[sdk-stderr] ${trimmed}`,
            agent: agentField,
            request_id: requestId,
          });
        }
      },
    },
  });

  // Track partial tool inputs across stream events
  const toolBlocks = new Map<number, { name: string; id: string; input: string }>();

  const done = (async () => {
    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        if (msg.type === "stream_event") {
          const ev = msg.event as Record<string, unknown>;
          const isNested = !!(msg as { parent_tool_use_id?: string | null }).parent_tool_use_id;

          if (ev.type === "content_block_start") {
            const block = ev.content_block as
              | { type?: string; name?: string; id?: string }
              | undefined;
            if (block?.type === "tool_use" && block.name) {
              const idx = ev.index as number;
              toolBlocks.set(idx, { name: block.name, id: block.id ?? "", input: "" });
            }
          } else if (ev.type === "content_block_delta") {
            const delta = ev.delta as
              | { type?: string; text?: string; thinking?: string; partial_json?: string }
              | undefined;
            if (delta?.type === "text_delta" && delta.text) {
              emit({ type: "text", text: delta.text, agent: agentField, request_id: requestId });
            } else if (delta?.type === "thinking_delta" && delta.thinking) {
              emit({
                type: "thinking",
                text: delta.thinking,
                agent: agentField,
                request_id: requestId,
              });
            } else if (delta?.type === "input_json_delta" && delta.partial_json) {
              const idx = ev.index as number;
              const tool = toolBlocks.get(idx);
              if (tool) tool.input += delta.partial_json;
            }
          } else if (ev.type === "content_block_stop") {
            const idx = ev.index as number;
            const tool = toolBlocks.get(idx);
            if (tool) {
              let input: Record<string, unknown> | undefined;
              try {
                input = JSON.parse(tool.input);
              } catch {
                /* incomplete JSON — omit input field */
              }
              emit({
                type: "tool_use",
                tool: tool.name,
                id: tool.id,
                input,
                nested: isNested || undefined,
                agent: agentField,
                request_id: requestId,
              });
              // Surface TodoWrite as a dedicated todo event for UI rendering
              if (tool.name === "TodoWrite" && input) {
                const todos = (input as { todos?: unknown[] }).todos;
                if (Array.isArray(todos)) {
                  emit({
                    type: "todo",
                    todos: todos as TodoItem[],
                    agent: agentField,
                    request_id: requestId,
                  });
                }
              }
              toolBlocks.delete(idx);
            }
          }
        } else if (msg.type === "tool_progress") {
          const tp = msg as unknown as {
            tool_name?: string;
            tool_use_id?: string;
            elapsed_time_seconds?: number;
            task_id?: string;
          };
          emit({
            type: "tool_log",
            tool: tp.tool_name ?? "unknown",
            phase: "pre",
            detail: {
              status: "running",
              tool_use_id: tp.tool_use_id ?? "",
              elapsed_time_seconds: tp.elapsed_time_seconds,
              task_id: tp.task_id,
            },
            agent: agentField,
            request_id: requestId,
          });
        } else if (msg.type === "tool_use_summary") {
          const s = msg as unknown as { summary?: string; tool_summary?: string };
          const text = s.summary ?? s.tool_summary;
          if (text) {
            emit({
              type: "tool_log",
              tool: "summary",
              phase: "post",
              detail: { summary: text },
              agent: agentField,
              request_id: requestId,
            });
          }
        } else if (msg.type === "result") {
          const r = msg as unknown as {
            total_cost_usd?: number;
            is_error?: boolean;
            duration_ms?: number;
            session_id?: string;
          };
          opts.resultBag.sessionId = r.session_id ?? null;
          opts.resultBag.cost = r.total_cost_usd ?? 0;
          opts.resultBag.durationMs = r.duration_ms ?? Date.now() - t0;
          opts.resultBag.isError = r.is_error ?? false;
          if (r.session_id) opts.onResult?.(r.session_id);
        } else if (msg.type === "assistant") {
          const m = msg as unknown as { error?: string };
          if (m.error) {
            emit({
              type: "error",
              message: `[assistant] ${m.error}`,
              agent: agentField,
              request_id: requestId,
            });
          }
        } else {
          const t = (msg as Record<string, unknown>).type;
          if (t === "system") {
            const sys = msg as unknown as {
              subtype?: string;
              status?: string | null;
              compact_metadata?: { trigger: string; pre_tokens: number };
            };
            if (sys.subtype) {
              emit({
                type: "system",
                subtype: sys.subtype,
                detail: sys.compact_metadata
                  ? { ...sys.compact_metadata }
                  : { status: sys.status },
                agent: agentField,
                request_id: requestId,
              });
            }
          } else if (t === "streamlined_tool_use_summary") {
            const s = msg as unknown as { summary?: string; tool_summary?: string };
            const text = s.summary ?? s.tool_summary;
            if (text) {
              emit({
                type: "tool_log",
                tool: "summary",
                phase: "post",
                detail: { summary: text },
                agent: agentField,
                request_id: requestId,
              });
            }
          }
        }
      }
    } finally {
      toolBlocks.clear();
    }
  })();

  return { query: q, done };
}
