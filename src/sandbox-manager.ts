// input: Project IDs, sandbox commands, filesystem paths, event listeners
// output: Project-scoped sandbox lifecycle management and file/event access
// pos: Host bridge core — keeps the current sandbox protocol as the only source of truth

import { SandboxClient } from "./e2b-client.js";
import type { SandboxCommand, SandboxEvent } from "./protocol.js";
import { ProjectSession, SessionStore } from "./session-store.js";

export interface SandboxEntry {
  name: string;
  path: string;
  type?: string;
  size?: number;
}

export interface SandboxClientLike {
  sandboxId: string | null;
  start(): Promise<void>;
  destroy(): Promise<void>;
  sendCommand(cmd: SandboxCommand): Promise<void>;
  listFiles(path: string): Promise<SandboxEntry[]>;
  readFile(
    path: string,
    opts?: { format?: "text" | "bytes" },
  ): Promise<string | Uint8Array>;
  downloadUrl(path: string): Promise<string>;
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
  return new SandboxClient({ onEvent, onStderr });
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
      runtime.startPromise = runtime.client.start().then(() => {
        this.sessions.upsert(projectId, { sandboxId: runtime.client.sandboxId });
      }).catch((error) => {
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

    this.sessions.upsert(projectId, { sandboxId: runtime.client.sandboxId });
    for (const listener of runtime.listeners) {
      listener(event);
    }
  }
}
