// input: E2B SDK, protocol types
// output: SandboxClient class for managing E2B sandbox lifecycle + communication
// pos: Host-side E2B client — bridges JSON Lines protocol over E2B stdin/stdout

import { Sandbox } from "e2b";
import type { SandboxCommand, SandboxEvent } from "./protocol.js";

// ---------- Types ----------

export interface SandboxClientOptions {
  /** E2B template ID (from `e2b template build` or E2B dashboard) */
  templateId: string;
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
}

interface CommandHandle {
  pid: number;
  kill(): Promise<void>;
  wait(): Promise<unknown>;
}

// ---------- Client ----------

export class SandboxClient {
  private sandbox: Sandbox | null = null;
  private handle: CommandHandle | null = null;
  private lineBuffer = "";
  private eventCb: ((event: SandboxEvent) => void) | null;
  private stderrCb: ((data: string) => void) | null;

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
    this.sandbox = await Sandbox.create(this.opts.templateId, {
      apiKey: this.opts.apiKey,
      timeoutMs: this.opts.timeoutMs ?? 300_000,
    });

    const cmd =
      this.opts.startCommand ??
      "bun /app/dist/sandbox.js /app/workspace --skills /app/skills";

    // background: true → returns CommandHandle immediately
    // stdin: true → keeps stdin open so sendStdin() works
    this.handle = (await this.sandbox.commands.run(cmd, {
      background: true,
      stdin: true,
      onStdout: (data: string) => this.handleStdout(data),
      onStderr: (data: string) => this.stderrCb?.(data),
    })) as unknown as CommandHandle;
  }

  /** Connect to an already-running sandbox by ID */
  async connect(sandboxId: string): Promise<void> {
    this.sandbox = await Sandbox.connect(sandboxId, {
      apiKey: this.opts.apiKey,
    });
  }

  async destroy(): Promise<void> {
    if (this.handle) {
      await this.handle.kill().catch(() => {});
      this.handle = null;
    }
    if (this.sandbox) {
      await this.sandbox.kill().catch(() => {});
      this.sandbox = null;
    }
    this.lineBuffer = "";
  }

  // ---------- Commands ----------

  async sendCommand(cmd: SandboxCommand): Promise<void> {
    if (!this.sandbox || !this.handle) {
      throw new Error("Sandbox not started — call start() first");
    }
    await this.sandbox.commands.sendStdin(
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

  // ---------- Getters ----------

  get sandboxId(): string | null {
    return this.sandbox?.sandboxId ?? null;
  }

  get pid(): number | null {
    return this.handle?.pid ?? null;
  }

  // ---------- Internal ----------

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
