// input: E2B SDK, protocol types
// output: SandboxClient class for managing E2B sandbox lifecycle + communication
// pos: Host-side E2B client — bridges JSON Lines protocol over E2B stdin/stdout

import { Sandbox } from "e2b";
import type { SandboxCommand, SandboxEvent } from "./protocol.js";

// ---------- Types ----------

export interface SandboxClientOptions {
  /** E2B template ID (defaults to "agentos-sandbox") */
  templateId?: string;
  /** E2B API key (defaults to E2B_API_KEY env var) */
  apiKey?: string;
  /** Sandbox timeout in ms (default: 5 min) */
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
        timeoutMs: this.opts.timeoutMs ?? 300_000,
      },
    );

    await this.startProcess();
    this.startHeartbeat();
  }

  /** Connect to an already-running sandbox by ID */
  async connect(sandboxId: string): Promise<void> {
    this._sandbox = await Sandbox.connect(sandboxId, {
      apiKey: this.opts.apiKey,
    });
  }

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

  async readFile(filePath: string) {
    if (!this._sandbox) throw new Error("Sandbox not started");
    return this._sandbox.files.read(filePath);
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
      "bun /home/user/app/dist/sandbox.js /home/user/app/workspace --skills /home/user/app/skills";

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
      if (this.isConnected && !this.reconnecting) {
        this.sendCommand({ cmd: "status" }).catch(() => {
          // Heartbeat failure is handled by process monitor
        });
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
