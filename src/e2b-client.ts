// input: E2B SDK, protocol types
// output: SandboxClient class for managing E2B sandbox lifecycle + communication + file sync
// pos: Host-side E2B client — bridges JSON Lines protocol over E2B stdin/stdout

import { Sandbox } from "e2b";
import type { SandboxCommand, SandboxEvent } from "./protocol.js";

// ---------- Types ----------

export interface SandboxClientOptions {
  /** E2B template ID (defaults to "agentos-sandbox") */
  templateId?: string;
  /** E2B API key (defaults to E2B_API_KEY env var) */
  apiKey?: string;
  /** Sandbox timeout in ms (default: 10 min) */
  timeoutMs?: number;
  /** Event callback — receives every parsed JSON line from sandbox stdout */
  onEvent?: (event: SandboxEvent) => void;
  /** Raw stderr callback */
  onStderr?: (data: string) => void;
  /** Start command override (defaults to standard sandbox entrypoint) */
  startCommand?: string;
  /** Environment variables passed to the sandbox process */
  envs?: Record<string, string>;
  /** Heartbeat interval in ms (default: 60_000). Set 0 to disable. */
  heartbeatMs?: number;
  /** Max consecutive reconnect attempts (default: 3). Set 0 to disable auto-reconnect. */
  maxReconnects?: number;
  /** Called after sandbox is recreated during reconnection. Use to re-sync files. */
  onSandboxRecreated?: (client: SandboxClient) => Promise<void>;
}

interface CommandHandle {
  pid: number;
  kill(): Promise<void>;
  wait(): Promise<unknown>;
}

// ---------- Client ----------

export class SandboxClient {
  private _sandbox: Sandbox | null = null;
  private handle: CommandHandle | null = null;
  private lineBuffer = "";
  private eventCb: ((event: SandboxEvent) => void) | null;
  private stderrCb: ((data: string) => void) | null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatFailCount = 0;
  private reconnecting = false;
  private reconnectCount = 0;
  private destroyed = false;

  constructor(private opts: SandboxClientOptions) {
    this.eventCb = opts.onEvent ?? null;
    this.stderrCb = opts.onStderr ?? null;
  }

  // ---------- Lifecycle ----------

  /**
   * Create a new sandbox and start the agent process inside it.
   * The process runs in background mode so we get a PID for stdin/stdout.
   */
  async start(): Promise<void> {
    this._sandbox = await Sandbox.create(
      this.opts.templateId ?? "agentos-sandbox",
      {
        apiKey: this.opts.apiKey,
        timeoutMs: this.opts.timeoutMs ?? 600_000,
      },
    );

    await this.startProcess();
    this.startHeartbeat();
  }

  /** Connect to an already-running sandbox by ID and start agent process */
  async connect(sandboxId: string): Promise<void> {
    this._sandbox = await Sandbox.connect(sandboxId, {
      apiKey: this.opts.apiKey,
    });
    await this.startProcess();
    this.startHeartbeat();
  }

  /** Disconnect from sandbox without destroying it — sandbox stays alive for reconnect */
  async disconnect(): Promise<void> {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.handle) {
      await this.handle.kill().catch(() => {});
      this.handle = null;
    }
    this._sandbox = null;
    this.lineBuffer = "";
  }

  /** Destroy the sandbox entirely — cannot be reconnected */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.handle) {
      await this.handle.kill().catch(() => {});
      this.handle = null;
    }
    if (this._sandbox) {
      await this._sandbox.kill().catch(() => {});
      this._sandbox = null;
    }
    this.lineBuffer = "";
  }

  // ---------- Commands ----------

  async sendCommand(cmd: SandboxCommand): Promise<void> {
    if (!this._sandbox || !this.handle) {
      throw new Error("Sandbox not started — call start() first");
    }
    await this._sandbox.commands.sendStdin(
      this.handle.pid,
      JSON.stringify(cmd) + "\n",
    );
  }

  async chat(message: string): Promise<void> {
    await this.sendCommand({ cmd: "chat", message });
  }

  async interrupt(): Promise<void> {
    await this.sendCommand({ cmd: "interrupt" });
  }

  async status(): Promise<void> {
    await this.sendCommand({ cmd: "status" });
  }

  async listSkills(): Promise<void> {
    await this.sendCommand({ cmd: "list_skills" });
  }

  // ---------- File System ----------

  async listFiles(dirPath: string) {
    if (!this._sandbox) throw new Error("Sandbox not started");
    return this._sandbox.files.list(dirPath);
  }

  async readFile(filePath: string): Promise<string>;
  async readFile(filePath: string, opts: { format: "text" }): Promise<string>;
  async readFile(filePath: string, opts: { format: "bytes" }): Promise<Uint8Array>;
  async readFile(
    filePath: string,
    opts?: { format?: "text" | "bytes" },
  ): Promise<string | Uint8Array> {
    if (!this._sandbox) throw new Error("Sandbox not started");
    if (opts?.format === "bytes") {
      return this._sandbox.files.read(filePath, { format: "bytes" });
    }
    return this._sandbox.files.read(filePath);
  }

  async downloadUrl(filePath: string) {
    if (!this._sandbox) throw new Error("Sandbox not started");
    return this._sandbox.downloadUrl(filePath);
  }

  async writeFile(filePath: string, content: string) {
    if (!this._sandbox) throw new Error("Sandbox not started");
    return this._sandbox.files.write(filePath, content);
  }

  /**
   * Recursively sync a local directory into the sandbox.
   * Walks localDir, uploads every file preserving relative paths.
   * Binary files are skipped (only text content supported by E2B files.write).
   */
  async syncDir(localDir: string, sandboxDir: string): Promise<string[]> {
    if (!this._sandbox) throw new Error("Sandbox not started");
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");

    const uploaded: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const localPath = nodePath.join(dir, entry.name);
        const rel = nodePath.relative(localDir, localPath);
        const remotePath = `${sandboxDir}/${rel}`;

        if (entry.isDirectory()) {
          await walk(localPath);
        } else if (entry.isFile()) {
          const content = await fs.readFile(localPath, "utf-8");
          await this._sandbox!.files.write(remotePath, content);
          uploaded.push(rel);
        }
      }
    };

    await walk(localDir);
    return uploaded;
  }

  /**
   * Recursively pull files from sandbox to local directory.
   * Mirrors sandbox directory structure locally. Only text files are pulled.
   */
  async pullDir(sandboxDir: string, localDir: string): Promise<string[]> {
    if (!this._sandbox) throw new Error("Sandbox not started");
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");

    const downloaded: string[] = [];

    const walk = async (remotePath: string, localPath: string): Promise<void> => {
      let entries;
      try {
        entries = await this._sandbox!.files.list(remotePath);
      } catch {
        return; // Directory doesn't exist in sandbox
      }

      await fs.mkdir(localPath, { recursive: true });

      for (const entry of entries) {
        const remoteFilePath = `${remotePath}/${entry.name}`;
        const localFilePath = nodePath.join(localPath, entry.name);

        if (entry.type === "dir") {
          await walk(remoteFilePath, localFilePath);
        } else {
          try {
            const content = await this._sandbox!.files.read(remoteFilePath);
            await fs.writeFile(localFilePath, content);
            const rel = nodePath.relative(localDir, localFilePath);
            downloaded.push(rel);
          } catch {
            // Skip unreadable files (binary, permissions, etc.)
          }
        }
      }
    };

    await walk(sandboxDir, localDir);
    return downloaded;
  }

  // ---------- Getters ----------

  get sandbox(): Sandbox | null {
    return this._sandbox;
  }

  get sandboxId(): string | null {
    return this._sandbox?.sandboxId ?? null;
  }

  get pid(): number | null {
    return this.handle?.pid ?? null;
  }

  get isConnected(): boolean {
    return this._sandbox !== null && this.handle !== null;
  }

  // ---------- Internal ----------

  /** Start the agent process inside an already-created sandbox */
  private async startProcess(): Promise<void> {
    if (!this._sandbox) throw new Error("No sandbox instance");

    const cmd =
      this.opts.startCommand ??
      "bun /home/user/app/dist/sandbox.js /home/user/app/workspace";

    this.lineBuffer = "";

    this.handle = (await this._sandbox.commands.run(cmd, {
      background: true,
      stdin: true,
      envs: this.opts.envs,
      timeoutMs: 0,
      onStdout: (data: string) => this.handleStdout(data),
      onStderr: (data: string) => this.stderrCb?.(data),
    })) as unknown as CommandHandle;

    this.monitorProcess();
  }

  /** Watch for process exit and trigger reconnection if applicable */
  private monitorProcess(): void {
    if (!this.handle) return;

    this.handle.wait().then((result: unknown) => {
      if (this.handle) {
        this.handle = null;
        const detail = result ? ` (${JSON.stringify(result)})` : "";
        this.stderrCb?.(`[exit] Sandbox agent process exited cleanly${detail}`);
        this.tryReconnect("process exited cleanly");
      }
    }).catch((err: unknown) => {
      if (this.handle) {
        this.handle = null;
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        const stack = err instanceof Error ? err.stack : undefined;
        this.stderrCb?.(`[crash] Sandbox agent process exited unexpectedly: ${msg}`);
        if (stack) this.stderrCb?.(`[crash-stack] ${stack}`);
        this.tryReconnect(msg);
      }
    });
  }

  /** Attempt to restart the agent process within the existing sandbox */
  private async tryReconnect(reason: string): Promise<void> {
    const maxRetries = this.opts.maxReconnects ?? 3;
    if (this.destroyed || this.reconnecting || maxRetries === 0) {
      this.emitDisconnected(reason);
      return;
    }

    if (this.reconnectCount >= maxRetries) {
      this.stderrCb?.(`[reconnect] Max retries (${maxRetries}) exceeded — giving up`);
      this.reconnectCount = 0;
      this.emitDisconnected(reason);
      return;
    }

    this.reconnecting = true;
    this.reconnectCount++;
    const attempt = this.reconnectCount;
    const delayMs = Math.min(1000 * 2 ** (attempt - 1), 10_000); // 1s, 2s, 4s ... max 10s

    this.stderrCb?.(`[reconnect] Attempt ${attempt}/${maxRetries} in ${delayMs}ms (reason: ${reason})`);
    this.eventCb?.({ type: "status", state: "disconnected" } as SandboxEvent);

    await new Promise((r) => setTimeout(r, delayMs));

    if (this.destroyed) {
      this.reconnecting = false;
      return;
    }

    try {
      // If sandbox itself is gone, recreate it
      if (this._sandbox) {
        let alive = await this._sandbox.isRunning().catch(() => false);
        if (!alive) {
          // Network glitch? Wait and retry once before declaring dead
          await new Promise((r) => setTimeout(r, 2000));
          alive = await this._sandbox.isRunning().catch(() => false);
        }
        if (!alive) {
          this.stderrCb?.(`[reconnect] Sandbox expired — creating new sandbox`);
          await this._sandbox.kill().catch(() => {});
          this._sandbox = await Sandbox.create(
            this.opts.templateId ?? "agentos-sandbox",
            {
              apiKey: this.opts.apiKey,
              timeoutMs: this.opts.timeoutMs ?? 600_000,
            },
          );
          await this.opts.onSandboxRecreated?.(this);
        }
      }
      await this.startProcess();
      this.reconnectCount = 0;
      this.stderrCb?.(`[reconnect] Process restarted successfully`);
      // ready event will come from the new process via stdout
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.stderrCb?.(`[reconnect] Failed to restart process: ${msg}`);
      this.reconnecting = false;
      await this.tryReconnect(msg);
      return;
    }
    this.reconnecting = false;
  }

  private emitDisconnected(reason: string): void {
    this.eventCb?.({ type: "error", message: `Sandbox disconnected: ${reason}` } as SandboxEvent);
    this.eventCb?.({ type: "status", state: "disconnected" } as SandboxEvent);
  }

  /** Periodic heartbeat to keep E2B sandbox alive */
  private startHeartbeat(): void {
    const interval = this.opts.heartbeatMs ?? 60_000;
    if (interval <= 0) return;

    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this._sandbox || this.reconnecting) return;
      // Extend sandbox lifetime so E2B platform doesn't reclaim it
      const timeout = this.opts.timeoutMs ?? 600_000;
      this._sandbox.setTimeout(timeout)
        .then(() => { this.heartbeatFailCount = 0; })
        .catch((err: unknown) => {
          this.heartbeatFailCount++;
          const msg = err instanceof Error ? err.message : String(err);
          this.stderrCb?.(`[heartbeat] setTimeout failed (${this.heartbeatFailCount}x): ${msg}`);
          if (this.heartbeatFailCount >= 3) {
            this.eventCb?.({ type: "status", state: "disconnected" } as SandboxEvent);
          }
        });
      // Also ping the agent process
      if (this.handle) {
        this.sendCommand({ cmd: "status" }).catch(() => {});
      }
    }, interval);
    // Don't block process exit
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleStdout(data: string): void {
    this.lineBuffer += data;
    const lines = this.lineBuffer.split("\n");
    // Keep incomplete trailing chunk in buffer
    this.lineBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as SandboxEvent;
        this.eventCb?.(event);
      } catch {
        // Non-JSON output — skip
      }
    }
  }
}

// ---------- Convenience factory ----------

export async function createSandbox(
  opts: SandboxClientOptions,
): Promise<SandboxClient> {
  const client = new SandboxClient(opts);
  await client.start();
  return client;
}
