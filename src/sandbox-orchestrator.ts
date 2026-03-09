// input: Project path, agent configs, SDK options
// output: Manages agent sessions, routes commands, emits events
// pos: Sole orchestration core — routes to per-agent .claude/ directories via SDK-native loading

import fs from "node:fs";
import path from "node:path";
import { createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildAgentOptions } from "./agent-options.js";
import { buildOptions } from "./options.js";
import { emit } from "./protocol.js";
import type { ChatCommand } from "./protocol.js";
import {
  createSwitchSignal,
  createSwitchToAgent,
  createReturnToMain,
  type SwitchSignal,
} from "./tools/agent-switch.js";

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
  busy: boolean;
  activeQuery: Query | null;
  options: Record<string, unknown>;
}

// ---------- Config ----------

export interface OrchestratorConfig {
  projectPath: string;
  agentsDir: string;
  model?: string;
}

// ---------- SandboxOrchestrator ----------

export class SandboxOrchestrator {
  private config: OrchestratorConfig;
  private mainSession: AgentSession | null = null;
  private agents = new Map<string, AgentSession>();
  private agentDefinitions: Record<string, { description: string }> = {};
  private _activeAgent: string | null = null;
  private baseOptions: Record<string, unknown> = {};
  /** Mutex — SDK shares global MCP Protocol, so only one query() at a time */
  private queryLock: Promise<void> = Promise.resolve();

  // Signal-driven agent switching
  private signal: SwitchSignal = createSwitchSignal();
  private masterSwitchServer: unknown = null;
  private agentSwitchServer: unknown = null;
  private sessionsFile: string;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.sessionsFile = path.join(config.projectPath, ".sessions.json");
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
      { description: string }
    >;

    // Create MCP servers for signal-driven switching
    const agentNames = Object.keys(this.agentDefinitions);
    if (agentNames.length > 0) {
      const switchTool = createSwitchToAgent(this.signal, agentNames);
      this.masterSwitchServer = createSdkMcpServer({ name: "switch", tools: [switchTool] });

      const returnTool = createReturnToMain(this.signal);
      this.agentSwitchServer = createSdkMcpServer({ name: "switch", tools: [returnTool] });

      // Inject switch server into master options
      const mcpServers = { ...(this.baseOptions.mcpServers as Record<string, unknown> ?? {}) };
      mcpServers.switch = this.masterSwitchServer;
      this.baseOptions.mcpServers = mcpServers;
    }

    // Restore persisted session IDs
    this.loadSessions();

    this.mainSession = this.createSession("main", this.baseOptions);

    // Agent sessions are created lazily on first use via getOrCreateAgent()

    emit({ type: "ready", skills: Object.keys(this.agentDefinitions) });
  }

  async startWorkers(): Promise<void> {
    if (!this.mainSession) return;
    // Only start main worker; agent workers start on-demand in getOrCreateAgent()
    await this.runWorker(this.mainSession);
  }

  // -- Lazy agent session management --

  /** Create agent session on first use and start its worker */
  private getOrCreateAgent(name: string): AgentSession | null {
    if (!this.agentDefinitions[name]) return null;

    let session = this.agents.get(name);
    if (!session) {
      const extraMcp = this.agentSwitchServer
        ? { switch: this.agentSwitchServer }
        : undefined;
      session = this.createSession(name, buildAgentOptions(
        this.baseOptions, this.config.agentsDir, this.config.projectPath, name, extraMcp,
      ));
      this.agents.set(name, session);
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

  enterAgent(name: string): void {
    const session = this.getOrCreateAgent(name);
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
    emit({ type: "agent_exited", agent: exited });
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

  chat(message: string, target?: string | null, requestId?: string): void {
    const session = target
      ? this.getOrCreateAgent(target)
      : this.mainSession;
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

  getSkillMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [name, defn] of Object.entries(this.agentDefinitions)) {
      map[name] = defn.description;
    }
    return map;
  }

  /** List all known agent names (from routing YAML), regardless of session state */
  get agentNames(): string[] {
    return Object.keys(this.agentDefinitions);
  }

  // -- Internal --

  private createSession(
    name: string,
    options: Record<string, unknown>,
  ): AgentSession {
    return {
      name,
      queue: new AsyncQueue(),
      sessionId: null,
      busy: false,
      activeQuery: null,
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
    let release: () => void;
    const next = new Promise<void>((r) => { release = r; });
    const prev = this.queryLock;
    this.queryLock = next;
    await prev;

    const t0 = Date.now();
    const agentField = session.name === "main" ? undefined : session.name;

    const q = query({
      prompt,
      options: {
        ...session.options,
        stderr: (data: string) => {
          const trimmed = data.trim();
          if (trimmed) emit({ type: "error", message: `[sdk-stderr] ${trimmed}`, agent: agentField, request_id: requestId });
        },
      },
    });
    session.activeQuery = q;

    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        if (msg.type === "stream_event") {
          const ev = msg.event as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (
            ev.type === "content_block_delta" &&
            ev.delta?.type === "text_delta" &&
            ev.delta.text
          ) {
            emit({ type: "text", text: ev.delta.text, agent: agentField, request_id: requestId });
          }
        } else if (msg.type === "tool_progress") {
          const tp = msg as unknown as { tool_name?: string; tool_use_id?: string };
          emit({
            type: "tool_use",
            tool: tp.tool_name ?? "unknown",
            id: tp.tool_use_id ?? "",
            agent: agentField,
            request_id: requestId,
          });
        } else if (msg.type === "result") {
          const r = msg as unknown as {
            total_cost_usd?: number;
            is_error?: boolean;
            duration_ms?: number;
            session_id?: string;
          };
          if (r.session_id) {
            session.sessionId = r.session_id;
            session.options.resume = r.session_id;
            session.options.continueConversation = false;
          }
          emit({
            type: "result",
            cost: r.total_cost_usd ?? 0,
            duration_ms: r.duration_ms ?? Date.now() - t0,
            session_id: session.sessionId ?? "",
            is_error: r.is_error ?? false,
            agent: agentField,
            request_id: requestId,
          });
        }
      }
    } finally {
      session.activeQuery = null;
      release!();
    }

    // Persist session IDs after each query
    this.saveSessions();

    // -- Signal-driven agent switching --

    // Master → Agent: main LLM called switch_to_agent
    if (session.name === "main" && this.signal.switchRequest) {
      const req = this.signal.switchRequest;
      this.signal.switchRequest = null;

      const agentSession = this.getOrCreateAgent(req.agent);
      if (agentSession) {
        this._activeAgent = req.agent;
        emit({ type: "agent_entered", agent: req.agent });
        if (req.task) {
          agentSession.queue.push({ prompt: req.task, requestId });
        }
      }
    }

    // Agent → Master: agent LLM called return_to_main
    if (session.name !== "main" && this.signal.returnRequest) {
      const req = this.signal.returnRequest;
      this.signal.returnRequest = null;

      const returned = session.name;
      this._activeAgent = null;
      emit({ type: "agent_exited", agent: returned });

      if (this.mainSession && req.summary) {
        this.mainSession.queue.push({
          prompt: `[${returned} completed] ${req.summary}`,
          requestId,
        });
      }
    }
  }

  // -- Session persistence --

  private loadSessions(): void {
    try {
      const data = JSON.parse(fs.readFileSync(this.sessionsFile, "utf-8")) as Record<string, string>;
      // Session IDs will be applied when sessions are created
      if (data.main && this.mainSession) {
        this.mainSession.sessionId = data.main;
        this.mainSession.options.resume = data.main;
        this.mainSession.options.continueConversation = false;
      }
      // Agent sessions are lazy — IDs are stored for later use
      for (const [name, sessionId] of Object.entries(data)) {
        if (name !== "main" && sessionId) {
          // Pre-create agent session so it picks up the session ID
          const session = this.getOrCreateAgent(name);
          if (session) {
            session.sessionId = sessionId;
            session.options.resume = sessionId;
            session.options.continueConversation = false;
          }
        }
      }
    } catch {
      // First run or corrupt file — start fresh
    }
  }

  private saveSessions(): void {
    const data: Record<string, string> = {};
    if (this.mainSession?.sessionId) data.main = this.mainSession.sessionId;
    for (const [name, session] of this.agents) {
      if (session.sessionId) data[name] = session.sessionId;
    }
    try {
      fs.writeFileSync(this.sessionsFile, JSON.stringify(data, null, 2));
    } catch {
      // Non-critical — session restore is best-effort
    }
  }
}
