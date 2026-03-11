// input: Project IDs, sandbox commands, filesystem paths, event listeners
// output: Project-scoped sandbox lifecycle management and file/event access
// pos: Host bridge core — keeps the current sandbox protocol as the only source of truth

import { loadDotEnv } from "./env.js";
import { SandboxClient } from "./e2b-client.js";
import type { SandboxCommand, SandboxEvent } from "./protocol.js";
import { ProjectSession, SessionStore } from "./session-store.js";

export interface SandboxEntry {
  name: string;
  path: string;
  type?: string;
  size?: number;
}

export type SandboxFileContent = string | Uint8Array | ArrayBuffer;

export interface SandboxClientLike {
  sandboxId: string | null;
  start(): Promise<void>;
  connect(sandboxId: string): Promise<void>;
  destroy(): Promise<void>;
  sendCommand(cmd: SandboxCommand): Promise<void>;
  listFiles(path: string): Promise<SandboxEntry[]>;
  readFile(
    path: string,
    opts?: { format?: "text" | "bytes" },
  ): Promise<string | Uint8Array>;
  downloadUrl(path: string): Promise<string>;
  writeFile(path: string, content: SandboxFileContent): Promise<unknown>;
}

export interface SandboxClientFactoryArgs {
  onEvent: (event: SandboxEvent) => void;
  onStderr?: (data: string) => void;
}

export type SandboxClientFactory = (
  args: SandboxClientFactoryArgs,
) => SandboxClientLike;

export interface SandboxManagerOptions {
  createClient?: SandboxClientFactory;
  sessionStore?: SessionStore;
  onStderr?: (projectId: string, data: string) => void;
}

type SandboxListener = (event: SandboxEvent) => void;

type SandboxRuntime = {
  client: SandboxClientLike;
  listeners: Set<SandboxListener>;
  startPromise: Promise<void> | null;
};

function createDefaultClient({
  onEvent,
  onStderr,
}: SandboxClientFactoryArgs): SandboxClientLike {
  // Prefer .env values over process.env — Claude Code sets ANTHROPIC_BASE_URL
  // to a local proxy unreachable from inside E2B sandbox.
  const dotEnv = loadDotEnv();
  return new SandboxClient({
    onEvent,
    onStderr,
    envs: {
      ANTHROPIC_API_KEY: dotEnv.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
      ANTHROPIC_BASE_URL: dotEnv.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "",
    },
  }) as unknown as SandboxClientLike;
}

export class SandboxManager {
  private readonly runtimes = new Map<string, SandboxRuntime>();
  private readonly createClient: SandboxClientFactory;
  private readonly sessions: SessionStore;
  private readonly onStderr?: (projectId: string, data: string) => void;

  constructor(options: SandboxManagerOptions = {}) {
    this.createClient = options.createClient ?? createDefaultClient;
    this.sessions = options.sessionStore ?? new SessionStore();
    this.onStderr = options.onStderr;
  }

  list(): ProjectSession[] {
    return this.sessions.list();
  }

  get(projectId: string): ProjectSession | null {
    return this.sessions.get(projectId);
  }

  async getOrCreate(projectId: string): Promise<ProjectSession> {
    const runtime = this.ensureRuntime(projectId);
    await this.ensureStarted(projectId, runtime);
    return this.sessions.upsert(projectId, { sandboxId: runtime.client.sandboxId });
  }

  async attach(
    projectId: string,
    listener: SandboxListener,
  ): Promise<() => void> {
    const runtime = this.ensureRuntime(projectId);
    runtime.listeners.add(listener);

    try {
      await this.ensureStarted(projectId, runtime);
    } catch (error) {
      runtime.listeners.delete(listener);
      throw error;
    }

    return () => {
      runtime.listeners.delete(listener);
    };
  }

  async sendCommand(projectId: string, cmd: SandboxCommand): Promise<void> {
    const runtime = await this.loadRuntime(projectId);
    await runtime.client.sendCommand(cmd);
    this.sessions.upsert(projectId, { sandboxId: runtime.client.sandboxId });
  }

  async listFiles(projectId: string, path: string): Promise<SandboxEntry[]> {
    const runtime = await this.loadRuntime(projectId);
    return this.collectEntries(runtime.client, path);
  }

  async readTextFile(projectId: string, path: string): Promise<string> {
    const runtime = await this.loadRuntime(projectId);
    const content = await runtime.client.readFile(path, { format: "text" });
    if (typeof content !== "string") {
      throw new Error(`Expected text content for ${path}`);
    }
    return content;
  }

  async readBinaryFile(projectId: string, path: string): Promise<Uint8Array> {
    const runtime = await this.loadRuntime(projectId);
    const content = await runtime.client.readFile(path, { format: "bytes" });
    if (!(content instanceof Uint8Array)) {
      throw new Error(`Expected binary content for ${path}`);
    }
    return content;
  }

  async getDownloadUrl(projectId: string, path: string): Promise<string> {
    const runtime = await this.loadRuntime(projectId);
    return runtime.client.downloadUrl(path);
  }

  async writeTextFile(
    projectId: string,
    path: string,
    content: string,
  ): Promise<void> {
    await this.uploadFile(projectId, path, content);
  }

  async uploadFile(
    projectId: string,
    path: string,
    content: SandboxFileContent,
  ): Promise<void> {
    const runtime = await this.loadRuntime(projectId);
    await runtime.client.writeFile(path, content);
    this.sessions.upsert(projectId, { sandboxId: runtime.client.sandboxId });
  }

  async syncTextFiles(
    projectId: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<string[]> {
    const runtime = await this.loadRuntime(projectId);
    for (const file of files) {
      await runtime.client.writeFile(file.path, file.content);
    }
    this.sessions.upsert(projectId, { sandboxId: runtime.client.sandboxId });
    return files.map((file) => file.path);
  }

  async destroy(projectId: string): Promise<void> {
    const runtime = this.runtimes.get(projectId);
    if (!runtime) {
      this.sessions.delete(projectId);
      return;
    }

    this.runtimes.delete(projectId);
    this.sessions.delete(projectId);
    await runtime.client.destroy();
  }

  /** Destroy all active sandboxes — call on server shutdown */
  async destroyAll(): Promise<void> {
    const ids = [...this.runtimes.keys()];
    await Promise.allSettled(ids.map((id) => this.destroy(id)));
  }

  private ensureRuntime(projectId: string): SandboxRuntime {
    const existing = this.runtimes.get(projectId);
    if (existing) {
      return existing;
    }

    const runtime: SandboxRuntime = {
      client: this.createClient({
        onEvent: (event) => this.broadcast(projectId, event),
        onStderr: (data) => this.onStderr?.(projectId, data),
      }),
      listeners: new Set(),
      startPromise: null,
    };

    this.runtimes.set(projectId, runtime);
    return runtime;
  }

  private async loadRuntime(projectId: string): Promise<SandboxRuntime> {
    const runtime = this.ensureRuntime(projectId);
    await this.ensureStarted(projectId, runtime);
    return runtime;
  }

  private async collectEntries(
    client: SandboxClientLike,
    path: string,
  ): Promise<SandboxEntry[]> {
    const entries = await client.listFiles(path);
    const collected: SandboxEntry[] = [];

    for (const entry of entries) {
      if (entry.path === path) {
        continue;
      }

      collected.push(entry);
      if (entry.type === "dir") {
        const childEntries = await this.collectEntries(client, entry.path);
        collected.push(...childEntries);
      }
    }

    return collected;
  }

  private async ensureStarted(
    projectId: string,
    runtime: SandboxRuntime,
  ): Promise<void> {
    if (!runtime.startPromise) {
      runtime.startPromise = (async () => {
        const persistedSandboxId = this.sessions.get(projectId)?.sandboxId;

        if (persistedSandboxId) {
          try {
            await runtime.client.connect(persistedSandboxId);
          } catch {
            await runtime.client.start();
          }
        } else {
          await runtime.client.start();
        }

        this.sessions.upsert(projectId, { sandboxId: runtime.client.sandboxId });
      })().catch((error) => {
        runtime.startPromise = null;
        this.runtimes.delete(projectId);
        throw error;
      });
    }

    await runtime.startPromise;
  }

  private broadcast(projectId: string, event: SandboxEvent): void {
    const runtime = this.runtimes.get(projectId);
    if (!runtime) {
      return;
    }

    const existing = this.sessions.get(projectId);
    const agentSessionIds = { ...(existing?.agentSessionIds ?? {}) };
    let activeAgent = existing?.activeAgent;

    if ("session_id" in event && typeof event.session_id === "string" && event.session_id) {
      const agentKey = event.agent ?? "main";
      agentSessionIds[agentKey] = event.session_id;
    }

    if (event.type === "agent_entered") {
      activeAgent = event.agent;
    } else if (event.type === "agent_exited") {
      activeAgent = null;
    }

    this.sessions.upsert(projectId, {
      sandboxId: runtime.client.sandboxId,
      agentSessionIds,
      activeAgent,
    });
    for (const listener of runtime.listeners) {
      listener(event);
    }
  }
}
