// input: Project path, agent configs, SDK options (host filesystem)
// output: Manages agent sessions, routes commands, emits events via protocol
// pos: Host-native orchestration core — manages signal-driven agent dispatch loop

import fs from "node:fs";
import path from "node:path";

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
import { runQuery } from "./local-runtime.js";
import { getVikingClient } from "./viking/index.js";
import { scanWorkspaceChanges, publishArtifacts } from "./viking/auto-publish.js";

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
  activeQueryHandle: { query: { close(): void } } | null;
  mcpServerNames: ToolServerName[];
  options: Record<string, unknown>;
}

// ---------- Config ----------

export interface OrchestratorConfig {
  projectPath: string;
  agentsDir: string;
  model?: string;
  /** Skip session restore — REPL mode starts fresh each time */
  freshStart?: boolean;
}

// ---------- LocalOrchestrator ----------

export class LocalOrchestrator {
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
      { description: string; mcpServers?: ToolServerName[]; configuredSkills?: string[] }
    >;
    // Don't leak non-standard agents map to SDK — only used for orchestrator routing
    delete (this.baseOptions as Record<string, unknown>).agents;

    this.mainSession = this.createSession(
      "main",
      this.baseOptions,
      Object.keys((this.baseOptions.mcpServers ?? {})) as ToolServerName[],
    );
    if (!this.config.freshStart) {
      this.loadSessions();
    }

    await this.emitSessionHistory();

    emit({ type: "ready", skills: Object.keys(this.agentDefinitions) });
  }

  async startWorkers(): Promise<void> {
    if (!this.mainSession) return;
    await this.runWorker(this.mainSession);
  }

  // -- Lazy agent session management --

  /** Create agent session on first use and start its worker */
  private async getOrCreateAgent(name: string): Promise<AgentSession | null> {
    if (!this.agentDefinitions[name]) return null;

    let session = this.agents.get(name);
    if (!session) {
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
      const pendingId = this.pendingSessionIds.get(name);
      if (pendingId) {
        session.sessionId = pendingId;
        session.options.resume = pendingId;
        session.options.continue = false;
        this.pendingSessionIds.delete(name);
      }
      this.agents.set(name, session);
      await this.emitHistoryForSession(session);
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
    if (session?.activeQueryHandle) {
      session.activeQueryHandle.query.close();
      session.activeQueryHandle = null;
    }
  }

  getStatus(target?: string | null): { busy: boolean; sessionId: string | null } {
    const session = target ? this.agents.get(target) : this.mainSession;
    return {
      busy: session?.busy ?? false,
      sessionId: session?.sessionId ?? null,
    };
  }

  getSkillMap(): Record<string, { description: string; skills?: string[]; mcpServers?: string[] }> {
    const map: Record<string, { description: string; skills?: string[]; mcpServers?: string[] }> = {};
    for (const [name, defn] of Object.entries(this.agentDefinitions)) {
      map[name] = { description: defn.description };
    }
    return map;
  }

  setModel(model: string): void {
    this.baseOptions.model = model;
    if (this.mainSession) this.mainSession.options.model = model;
    for (const session of this.agents.values()) {
      session.options.model = model;
    }
  }

  /** List all known agent names (from routing YAML), regardless of session state */
  get agentNames(): string[] {
    return Object.keys(this.agentDefinitions);
  }

  /** All active session IDs keyed by agent name (for exit summary). */
  get sessionIds(): Record<string, string> {
    const ids: Record<string, string> = {};
    if (this.mainSession?.sessionId) ids.main = this.mainSession.sessionId;
    for (const [name, session] of this.agents) {
      if (session.sessionId) ids[name] = session.sessionId;
    }
    return ids;
  }

  /** Resume the main session from a specific session ID. */
  async resumeSession(sessionId: string): Promise<void> {
    if (!this.mainSession) {
      emit({ type: "error", message: "No main session available to resume" });
      return;
    }

    this.mainSession.sessionId = sessionId;
    this.mainSession.options.resume = sessionId;
    this.mainSession.options.continue = false;
    this.mainSession.historyLoaded = false;

    this.saveSessions();
    await this.emitHistoryForSession(this.mainSession);

    const status = this.getStatus(null);
    emit({
      type: "status",
      state: status.busy ? "busy" : "idle",
      session_id: sessionId,
    });
  }

  /** Reset all sessions — start fresh conversations */
  resetSessions(): void {
    if (this.mainSession) {
      this.mainSession.sessionId = null;
      delete this.mainSession.options.resume;
      delete this.mainSession.options.continue;
      this.mainSession.historyLoaded = false;
    }
    for (const session of this.agents.values()) {
      session.sessionId = null;
      delete session.options.resume;
      delete session.options.continue;
      session.historyLoaded = false;
    }
    this.pendingSessionIds.clear();
    this._activeAgent = null;
    try { fs.unlinkSync(this.sessionsFile); } catch { /* ignore */ }
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
      activeQueryHandle: null,
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
    const next = new Promise<void>((r) => { release = r; });
    const prev = this.queryLock;
    this.queryLock = next;
    await prev;

    // Rebuild MCP server instances — SDK instances are single-use per query()
    session.options.mcpServers = this.freshMcpServers(
      session.name === "main",
      session.mcpServerNames,
    );

    const t0 = Date.now();
    const agentField = session.name === "main" ? undefined : session.name;

    const resultBag = {
      sessionId: null as string | null,
      cost: 0,
      durationMs: 0,
      isError: false,
    };

    const handle = runQuery({
      prompt,
      options: session.options,
      agentField,
      requestId,
      resultBag,
      onResult: (sessionId) => {
        session.sessionId = sessionId;
        session.options.resume = sessionId;
        session.options.continue = false;
      },
    });
    session.activeQueryHandle = handle;

    // Abort mid-stream when a switch/return signal fires
    const pollSignal = setInterval(() => {
      if (this.signal.switchRequest || this.signal.returnRequest) {
        handle.query.close();
      }
    }, 50);

    try {
      await handle.done;
    } finally {
      clearInterval(pollSignal);
      session.activeQueryHandle = null;
      release?.();
    }

    this.saveSessions();

    // -- Signal-driven agent switching --

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

    if (session.name !== "main" && this.signal.returnRequest) {
      const req = this.signal.returnRequest;
      this.signal.returnRequest = null;

      const returned = session.name;
      this._activeAgent = null;

      // Auto-publish workspace changes to OpenViking (best-effort, fire-and-forget)
      const viking = getVikingClient();
      if (viking) {
        scanWorkspaceChanges(this.config.projectPath, Date.now() - 600_000) // last 10 min
          .then(files => files.length > 0
            ? publishArtifacts(viking, files, { producer: returned, summary: req.summary })
            : 0,
          )
          .catch(() => { /* OpenViking unavailable */ });
      }

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

    // Emit final result only after signal handling — avoids premature result before switch
    if (resultBag.sessionId !== null || resultBag.cost > 0 || resultBag.durationMs > 0) {
      emit({
        type: "result",
        cost: resultBag.cost,
        duration_ms: resultBag.durationMs || Date.now() - t0,
        session_id: session.sessionId ?? "",
        is_error: resultBag.isError,
        agent: agentField,
        request_id: requestId,
      });
    }
  }

  // -- Session persistence --

  private loadSessions(): void {
    try {
      const data = JSON.parse(fs.readFileSync(this.sessionsFile, "utf-8")) as Record<
        string,
        string
      >;
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
