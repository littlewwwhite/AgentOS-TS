// input: Project path, agent configs, SDK options
// output: Manages agent sessions, routes commands, emits events
// pos: Sole orchestration core — replaces both REPL orchestrator and sandbox worker

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { buildOptions } from "./options.js";
import { emit } from "./protocol.js";
import type { ChatCommand } from "./protocol.js";

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
  skillsDir: string;
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
      this.config.skillsDir,
      this.config.model,
    )) as Record<string, unknown>;

    this.agentDefinitions = (this.baseOptions.agents ?? {}) as Record<
      string,
      { description: string }
    >;

    this.mainSession = this.createSession("main", this.baseOptions);

    for (const name of Object.keys(this.agentDefinitions)) {
      this.agents.set(name, this.createSession(name, this.buildAgentOptions(name)));
    }

    emit({ type: "ready", skills: Object.keys(this.agentDefinitions) });
  }

  async startWorkers(): Promise<void> {
    const workers: Promise<void>[] = [];
    if (this.mainSession) workers.push(this.runWorker(this.mainSession));
    for (const session of this.agents.values()) {
      workers.push(this.runWorker(session));
    }
    // Exit when any worker ends (e.g. fatal error)
    await Promise.race(workers);
  }

  // -- Agent context switching --

  enterAgent(name: string): void {
    if (!this.agents.has(name)) {
      emit({
        type: "error",
        message: `Unknown agent: "${name}". Available: ${[...this.agents.keys()].join(", ")}`,
      });
      return;
    }
    this._activeAgent = name;
    const session = this.agents.get(name)!;
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
      if (this.agents.has(cmd.target)) return cmd.target;
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
    const session = target ? this.agents.get(target) : this.mainSession;
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

  /** Derive agent-level options: strip orchestrator prompt, prevent agent recursion */
  private buildAgentOptions(name: string): Record<string, unknown> {
    const { systemPrompt: _orchestratorPrompt, ...rest } = this.baseOptions;
    return { ...rest, agent: name, agents: undefined, settingSources: [] };
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
  }
}
