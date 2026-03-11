// input: Project path, agent configs, SDK options
// output: Manages agent sessions, routes commands, emits events
// pos: Sole orchestration core — routes to per-agent .claude/ directories via SDK-native loading

import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildAgentOptions } from "./agent-options.js";
import { buildOptions } from "./options.js";
import { emit } from "./protocol.js";
import type { ChatCommand } from "./protocol.js";
import { HISTORY_LIMIT_SANDBOX, fetchHistory } from "./session-history.js";
import {
  type SwitchSignal,
  createDispatchServers,
  createSwitchSignal,
} from "./tools/agent-switch.js";
import { type ToolServerName, createToolServers } from "./tools/index.js";

// ---------- AsyncQueue ----------

export class AsyncQueue<T> {
  private waiters: Array<(value: T) => void> = [];
  private buffer: T[] = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.buffer.push(item);
    }
  }

  pull(): Promise<T> {
    const item = this.buffer.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise<T>((resolve) => this.waiters.push(resolve));
  }

  get pending(): number {
    return this.buffer.length;
  }
}

// ---------- Session ----------

interface AgentSession {
  name: string;
  queue: AsyncQueue<{ prompt: string; requestId?: string }>;
  sessionId: string | null;
  historyLoaded: boolean;
  busy: boolean;
  activeQuery: Query | null;
  mcpServerNames: ToolServerName[];
  options: Record<string, unknown>;
}

// ---------- Config ----------

export interface OrchestratorConfig {
  projectPath: string;
  agentsDir: string;
  model?: string;
  sessionPersistence?: {
    load(): Record<string, string>;
    save(data: Record<string, string>): void;
  };
}

// ---------- SandboxOrchestrator ----------

export class SandboxOrchestrator {
  private config: OrchestratorConfig;
  private mainSession: AgentSession | null = null;
  private agents = new Map<string, AgentSession>();
  private agentDefinitions: Record<
    string,
    {
      description: string;
      mcpServers?: ToolServerName[];
      configuredSkills?: string[];
    }
  > = {};
  private _activeAgent: string | null = null;
  private baseOptions: Record<string, unknown> = {};
  /** Mutex — SDK shares global MCP Protocol, so only one query() at a time */
  private queryLock: Promise<void> = Promise.resolve();

  // Signal-driven agent switching
  private signal: SwitchSignal = createSwitchSignal();
  private pendingSessionIds = new Map<string, string>();

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  get activeAgent(): string | null {
    return this._activeAgent;
  }

  // -- Lifecycle --

  async init(): Promise<void> {
    this.baseOptions = (await buildOptions(
      this.config.projectPath,
      this.config.agentsDir,
      this.config.model,
    )) as Record<string, unknown>;

    this.agentDefinitions = (this.baseOptions.agents ?? {}) as Record<
      string,
      { description: string; mcpServers?: ToolServerName[]; configuredSkills?: string[] }
    >;
    // Don't leak non-standard agents map to SDK — only used for orchestrator routing
    delete (this.baseOptions as Record<string, unknown>).agents;

    // Restore persisted session IDs
    this.mainSession = this.createSession(
      "main",
      this.baseOptions,
      Object.keys((this.baseOptions.mcpServers ?? {})) as ToolServerName[],
    );
    this.loadSessions();

    // Emit history for resumed sessions, then signal ready
    await this.emitSessionHistory();

    emit({ type: "ready", skills: Object.keys(this.agentDefinitions) });
  }

  async startWorkers(): Promise<void> {
    if (!this.mainSession) return;
    // Only start main worker; agent workers start on-demand in getOrCreateAgent()
    await this.runWorker(this.mainSession);
  }

  // -- Lazy agent session management --

  /** Create agent session on first use and start its worker */
  private async getOrCreateAgent(name: string): Promise<AgentSession | null> {
    if (!this.agentDefinitions[name]) return null;

    let session = this.agents.get(name);
    if (!session) {
      // mcpServers will be refreshed per-query in processQuery()
      const opts = await buildAgentOptions(
        this.baseOptions,
        this.config.agentsDir,
        this.config.projectPath,
        name,
        {
          name,
          description: this.agentDefinitions[name].description,
          skills: [...(this.agentDefinitions[name].configuredSkills ?? [])],
          mcpServers: [...(this.agentDefinitions[name].mcpServers ?? [])],
        },
      );
      session = this.createSession(name, opts, this.agentDefinitions[name].mcpServers ?? []);
      // Apply persisted session ID if available
      const pendingId = this.pendingSessionIds.get(name);
      if (pendingId) {
        session.sessionId = pendingId;
        session.options.resume = pendingId;
        session.options.continue = false;
        this.pendingSessionIds.delete(name);
      }
      this.agents.set(name, session);
      await this.emitHistoryForSession(session);
      // Start worker in background — fire and forget
      this.runWorker(session).catch((err) => {
        emit({
          type: "error",
          message: `Agent worker "${name}" crashed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    }
    return session;
  }

  // -- Agent context switching --

  async enterAgent(name: string): Promise<void> {
    const session = await this.getOrCreateAgent(name);
    if (!session) {
      emit({
        type: "error",
        message: `Unknown agent: "${name}". Available: ${Object.keys(this.agentDefinitions).join(", ")}`,
      });
      return;
    }
    this._activeAgent = name;
    emit({
      type: "agent_entered",
      agent: name,
      reason: "manual",
      ...(session.sessionId ? { session_id: session.sessionId } : {}),
    });
  }

  exitAgent(): void {
    if (!this._activeAgent) {
      emit({ type: "error", message: "Not in an agent session" });
      return;
    }
    const exited = this._activeAgent;
    this._activeAgent = null;
    emit({ type: "agent_exited", agent: exited, reason: "manual" });
  }

  /** Update model for future sessions. Existing sessions keep their model. */
  setModel(model: string): void {
    this.baseOptions.model = model;
    emit({
      type: "system",
      subtype: "model_changed",
      detail: { model },
    });
  }

  // -- Routing --

  resolveTarget(cmd: ChatCommand): string | null {
    if (cmd.target) {
      if (this.agentDefinitions[cmd.target]) return cmd.target;
      emit({
        type: "error",
        message: `Unknown target agent: "${cmd.target}"`,
        request_id: cmd.request_id,
      });
      return null;
    }
    return this._activeAgent;
  }

  // -- Commands --

  async chat(message: string, target?: string | null, requestId?: string): Promise<void> {
    const session = target ? await this.getOrCreateAgent(target) : this.mainSession;
    if (!session) {
      emit({ type: "error", message: "No session available", request_id: requestId });
      return;
    }
    session.queue.push({ prompt: message, requestId });
  }

  interrupt(target?: string | null): void {
    const session = target ? this.agents.get(target) : this.mainSession;
    if (session?.activeQuery) {
      session.activeQuery.close();
      session.activeQuery = null;
    }
  }

  getStatus(target?: string | null): { busy: boolean; sessionId: string | null } {
    const session = target ? this.agents.get(target) : this.mainSession;
    return {
      busy: session?.busy ?? false,
      sessionId: session?.sessionId ?? null,
    };
  }

  getSkillMap(): Record<string, import("./protocol.js").AgentDetail> {
    const map: Record<string, import("./protocol.js").AgentDetail> = {};
    for (const [name, defn] of Object.entries(this.agentDefinitions)) {
      map[name] = {
        description: defn.description,
        ...(defn.configuredSkills?.length ? { skills: defn.configuredSkills } : {}),
        ...(defn.mcpServers?.length ? { mcpServers: defn.mcpServers } : {}),
      };
    }
    return map;
  }

  /** List all known agent names (from routing YAML), regardless of session state */
  get agentNames(): string[] {
    return Object.keys(this.agentDefinitions);
  }

  // -- Internal --

  /** Fresh MCP servers for each query() — SDK instances are single-use. */
  private freshMcpServers(isMain: boolean, names: ToolServerName[] = []): Record<string, unknown> {
    const agentNames = Object.keys(this.agentDefinitions);
    const servers: Record<string, unknown> = { ...createToolServers(names) };
    if (agentNames.length > 0) {
      const { masterServer, fullServer } = createDispatchServers(this.signal, agentNames);
      servers.switch = isMain ? masterServer : fullServer;
    }
    return servers;
  }

  private createSession(
    name: string,
    options: Record<string, unknown>,
    mcpServerNames: ToolServerName[],
  ): AgentSession {
    return {
      name,
      queue: new AsyncQueue(),
      sessionId: null,
      historyLoaded: false,
      busy: false,
      activeQuery: null,
      mcpServerNames: [...mcpServerNames],
      options: { ...options },
    };
  }

  private async runWorker(session: AgentSession): Promise<void> {
    while (true) {
      const { prompt, requestId } = await session.queue.pull();
      session.busy = true;
      try {
        await this.processQuery(prompt, session, requestId);
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
          agent: session.name === "main" ? undefined : session.name,
          request_id: requestId,
        });
      } finally {
        session.busy = false;
      }
    }
  }

  private async processQuery(
    prompt: string,
    session: AgentSession,
    requestId?: string,
  ): Promise<void> {
    if (!prompt?.trim()) {
      emit({
        type: "error",
        message: "Empty prompt — nothing to process",
        agent: session.name === "main" ? undefined : session.name,
        request_id: requestId,
      });
      return;
    }

    // Serialize SDK queries — shared MCP Protocol cannot handle concurrent connections
    let release!: () => void;
    const next = new Promise<void>((r) => {
      release = r;
    });
    const prev = this.queryLock;
    this.queryLock = next;
    await prev;

    // SDK MCP server instances are single-use per query() — create fresh ones
    session.options.mcpServers = this.freshMcpServers(
      session.name === "main",
      session.mcpServerNames,
    );

    const t0 = Date.now();
    const agentField = session.name === "main" ? undefined : session.name;

    const q = query({
      prompt,
      options: {
        ...session.options,
        includePartialMessages: true,
        stderr: (data: string) => {
          const trimmed = data.trim();
          // SDK skill-improvement hooks fire after session close, producing
          // noisy "Error in hook callback" + "Stream closed" errors. Harmless.
          if (!trimmed || trimmed.includes("Error in hook callback")) return;
          emit({
            type: "error",
            message: `[sdk-stderr] ${trimmed}`,
            agent: agentField,
            request_id: requestId,
          });
        },
      },
    });
    session.activeQuery = q;

    // Track tool blocks across stream events (mirrors local CLI's toolBlocks map)
    const toolBlocks = new Map<number, { name: string; id: string; input: string }>();
    let pendingResult: {
      type: "result";
      cost: number;
      duration_ms: number;
      session_id: string;
      is_error: boolean;
      agent?: string;
      request_id?: string;
    } | null = null;

    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        // Abort immediately when a switch/return tool fires mid-stream.
        // Without this, the LLM continues generating text after the tool
        // returns, producing output that looks like a successful switch
        // but is actually the same session hallucinating the other agent.
        if (this.signal.switchRequest || this.signal.returnRequest) {
          q.close();
          break;
        }

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
                /* incomplete */
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
              // Forward TodoWrite as a structured todo event for REPL rendering
              if (tool.name === "TodoWrite" && input) {
                const todos = (input as { todos?: unknown[] }).todos;
                if (Array.isArray(todos)) {
                  emit({
                    type: "todo",
                    todos: todos as import("./protocol.js").TodoItem[],
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
            num_turns?: number;
          };
          if (r.session_id) {
            session.sessionId = r.session_id;
            session.options.resume = r.session_id;
            session.options.continue = false;
          }
          pendingResult = {
            type: "result",
            cost: r.total_cost_usd ?? 0,
            duration_ms: r.duration_ms ?? Date.now() - t0,
            session_id: session.sessionId ?? "",
            is_error: r.is_error ?? false,
            agent: agentField,
            request_id: requestId,
          };
        } else if (msg.type === "assistant") {
          // SDKAssistantMessage.error is a string enum (e.g. 'rate_limit', 'billing_error'),
          // not an object. Surface it so the frontend can react.
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
                detail: sys.compact_metadata ? { ...sys.compact_metadata } : { status: sys.status },
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
      session.activeQuery = null;
      release?.();
    }

    // Persist session IDs after each query
    this.saveSessions();

    // -- Signal-driven agent switching --

    // Any session called switch_to_agent
    if (this.signal.switchRequest) {
      const req = this.signal.switchRequest;
      this.signal.switchRequest = null;

      const agentSession = await this.getOrCreateAgent(req.agent);
      if (agentSession) {
        this._activeAgent = req.agent;
        emit({
          type: "agent_entered",
          agent: req.agent,
          reason: "delegation",
          parent_agent: session.name,
          request_id: requestId,
        });
        if (req.task) {
          agentSession.queue.push({ prompt: req.task, requestId });
        }
      }
      return;
    }

    // Agent → Master: agent LLM called return_to_main
    if (session.name !== "main" && this.signal.returnRequest) {
      const req = this.signal.returnRequest;
      this.signal.returnRequest = null;

      const returned = session.name;
      this._activeAgent = null;
      emit({
        type: "agent_exited",
        agent: returned,
        reason: "return",
        parent_agent: "main",
        request_id: requestId,
      });

      if (this.mainSession && req.summary) {
        this.mainSession.queue.push({
          prompt: `[${returned} completed] ${req.summary}`,
          requestId,
        });
      }
      return;
    }

    if (pendingResult) {
      emit(pendingResult);
    }
  }

  // -- Session persistence --

  private loadSessions(): void {
    if (!this.config.sessionPersistence) return;

    try {
      const data = this.config.sessionPersistence.load();
      if (data.main && this.mainSession) {
        this.mainSession.sessionId = data.main;
        this.mainSession.options.resume = data.main;
        this.mainSession.options.continue = false;
      }
      for (const [name, sessionId] of Object.entries(data)) {
        if (name !== "main" && sessionId) {
          this.pendingSessionIds.set(name, sessionId);
        }
      }
    } catch {
      // First run or callback error — start fresh
    }
  }

  private saveSessions(): void {
    if (!this.config.sessionPersistence) return;

    const data: Record<string, string> = {};
    if (this.mainSession?.sessionId) data.main = this.mainSession.sessionId;
    for (const [name, session] of this.agents) {
      if (session.sessionId) data[name] = session.sessionId;
    }
    try {
      this.config.sessionPersistence.save(data);
    } catch {
      // Non-critical — session restore is best-effort
    }
  }

  private async emitSessionHistory(): Promise<void> {
    if (this.mainSession) await this.emitHistoryForSession(this.mainSession);
    for (const session of this.agents.values()) {
      await this.emitHistoryForSession(session);
    }
  }

  private async emitHistoryForSession(session: AgentSession): Promise<void> {
    if (!session.sessionId || session.historyLoaded) return;

    const dir =
      session.name === "main"
        ? this.config.projectPath
        : path.resolve(this.config.agentsDir, session.name);
    const messages = await fetchHistory(session.sessionId, dir, HISTORY_LIMIT_SANDBOX);

    session.historyLoaded = true;
    if (messages.length === 0) return;

    if (session.name === "main") {
      emit({ type: "history", messages });
      return;
    }

    emit({ type: "history", agent: session.name, messages });
  }
}
