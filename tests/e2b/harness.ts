// input: SandboxClient, protocol types, .env file
// output: E2BTestHarness class for vitest-based E2B integration tests
// pos: Test infrastructure — wraps SandboxClient with typed event queries and cursor management

import { SandboxClient } from "../../src/e2b-client.js";
import { loadDotEnv, type DotEnv } from "../../src/env.js";
import type {
  SandboxCommand,
  SandboxEvent,
  ReadyEvent,
} from "../../src/protocol.js";

export { loadDotEnv, type DotEnv };

// ---------- Type-safe event extraction ----------

type EventOfType<T extends SandboxEvent["type"]> = Extract<
  SandboxEvent,
  { type: T }
>;

// ---------- Harness ----------

export class E2BTestHarness {
  private client: SandboxClient | null = null;
  private events: SandboxEvent[] = [];
  private stderrBuf: string[] = [];
  private cursor = 0;
  private dotEnv: DotEnv;

  constructor(dotEnv?: DotEnv) {
    this.dotEnv = dotEnv ?? loadDotEnv();
  }

  // ---------- Lifecycle ----------

  async setup(): Promise<ReadyEvent> {
    const env = this.dotEnv;
    this.client = new SandboxClient({
      templateId: "agentos-sandbox",
      apiKey: env.E2B_API_KEY ?? process.env.E2B_API_KEY,
      timeoutMs: 300_000,
      envs: {
        ANTHROPIC_API_KEY:
          env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
        ANTHROPIC_BASE_URL:
          env.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "",
      },
      onEvent: (event) => {
        this.events.push(event);
      },
      onStderr: (data) => {
        this.stderrBuf.push(data);
      },
    });

    await this.client.start();
    const ready = await this.waitForEvent("ready", 60_000);
    // Small settle time for sandbox initialization
    await new Promise((r) => setTimeout(r, 1_000));
    return ready;
  }

  async teardown(): Promise<void> {
    if (this.client) {
      await this.client.destroy().catch(() => {});
      this.client = null;
    }
  }

  // ---------- Cursor management ----------

  /** Advance cursor to current end — ignore all prior events */
  resetCursor(): void {
    this.cursor = this.events.length;
  }

  // ---------- Typed event queries ----------

  /**
   * Wait for an event of the given type, starting from the current cursor.
   * Advances the cursor past the found event.
   */
  async waitForEvent<T extends SandboxEvent["type"]>(
    type: T,
    timeoutMs = 10_000,
    filter?: (event: EventOfType<T>) => boolean,
  ): Promise<EventOfType<T>> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      for (let i = this.cursor; i < this.events.length; i++) {
        const evt = this.events[i];
        if (evt.type === type && (!filter || filter(evt as EventOfType<T>))) {
          this.cursor = i + 1;
          return evt as EventOfType<T>;
        }
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(
      `Timeout (${timeoutMs}ms) waiting for event: ${type}` +
        `\n  Events since cursor: ${JSON.stringify(this.eventsSince().map((e) => e.type))}`,
    );
  }

  /** Find event of given type from cursor without advancing cursor */
  findEvent<T extends SandboxEvent["type"]>(
    type: T,
  ): EventOfType<T> | null {
    for (let i = this.cursor; i < this.events.length; i++) {
      if (this.events[i].type === type) {
        return this.events[i] as EventOfType<T>;
      }
    }
    return null;
  }

  /** Return all events from cursor to current end */
  eventsSince(): SandboxEvent[] {
    return this.events.slice(this.cursor);
  }

  /** Collect text event chunks since cursor, optionally filtered by request_id */
  collectText(requestId?: string): string {
    return this.eventsSince()
      .filter(
        (e) =>
          e.type === "text" &&
          (requestId == null || e.request_id === requestId),
      )
      .map((e) => (e as Extract<SandboxEvent, { type: "text" }>).text)
      .join("");
  }

  /** Collect text from ALL events (ignores cursor), filtered by request_id */
  collectAllText(requestId: string): string {
    return this.events
      .filter((e) => e.type === "text" && e.request_id === requestId)
      .map((e) => (e as Extract<SandboxEvent, { type: "text" }>).text)
      .join("");
  }

  // ---------- Command helpers ----------

  async send(cmd: SandboxCommand): Promise<void> {
    if (!this.client) throw new Error("Harness not started");
    await this.client.sendCommand(cmd);
  }

  /**
   * Reset cursor, send a chat command with auto-generated request_id,
   * and wait for the corresponding result event.
   *
   * If the sandbox process restarts mid-query (indicated by a new "ready" event),
   * the command is automatically re-sent with a fresh request_id since the
   * original in-flight query was lost.
   */
  async chatAndWaitResult(
    message: string,
    opts?: { target?: string; timeoutMs?: number; requestId?: string },
  ): Promise<EventOfType<"result"> & { _request_id: string }> {
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const requestId = opts?.requestId ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.resetCursor();
      await this.send({
        cmd: "chat",
        message,
        target: opts?.target,
        request_id: requestId,
      });

      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        for (let i = this.cursor; i < this.events.length; i++) {
          const evt = this.events[i];
          // Found our result — return it
          if (evt.type === "result" && evt.request_id === requestId) {
            this.cursor = i + 1;
            return Object.assign(evt as EventOfType<"result">, { _request_id: requestId });
          }
          // Process restarted — retry the command
          if (evt.type === "ready" && attempt < maxRetries) {
            this.cursor = i + 1;
            // Wait for the new process to settle
            await new Promise((r) => setTimeout(r, 2_000));
            break;
          }
        }
        // Check if we broke out of the inner loop for a retry
        const readyFound = this.eventsSince().some(e => e.type === "ready");
        if (readyFound && attempt < maxRetries) break;
        await new Promise((r) => setTimeout(r, 150));
      }

      // If we got here without breaking for retry, it's a genuine timeout
      if (attempt === maxRetries) break;
    }

    throw new Error(
      `Timeout (${timeoutMs}ms) waiting for event: result` +
        `\n  Events since cursor: ${JSON.stringify(this.eventsSince().map((e) => e.type))}`,
    );
  }

  // ---------- File system pass-through ----------

  async listFiles(dirPath: string) {
    if (!this.client) throw new Error("Harness not started");
    return this.client.listFiles(dirPath);
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.client) throw new Error("Harness not started");
    return this.client.readFile(filePath);
  }

  /** Write a file into the running sandbox */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.client) throw new Error("Harness not started");
    await this.client.writeFile(filePath, content);
  }

  /** Upload a local file into the sandbox */
  async uploadLocalFile(localPath: string, sandboxPath: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(localPath, "utf-8");
    await this.writeFile(sandboxPath, content);
  }

  /** Recursively sync a local directory into the sandbox */
  async syncDir(localDir: string, sandboxDir: string): Promise<string[]> {
    if (!this.client) throw new Error("Harness not started");
    return this.client.syncDir(localDir, sandboxDir);
  }

  // ---------- State ----------

  get sandboxId(): string | null {
    return this.client?.sandboxId ?? null;
  }

  get allEvents(): SandboxEvent[] {
    return [...this.events];
  }

  get stderr(): string {
    return this.stderrBuf.join("");
  }
}
