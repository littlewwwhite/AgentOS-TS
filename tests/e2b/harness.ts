// input: SandboxClient, protocol types, .env file
// output: E2BTestHarness class for vitest-based E2B integration tests
// pos: Test infrastructure — wraps SandboxClient with typed event queries and cursor management

import fs from "node:fs";
import path from "node:path";
import { SandboxClient } from "../../src/e2b-client.js";
import type {
  SandboxCommand,
  SandboxEvent,
  ReadyEvent,
} from "../../src/protocol.js";

// ---------- Type-safe event extraction ----------

type EventOfType<T extends SandboxEvent["type"]> = Extract<
  SandboxEvent,
  { type: T }
>;

// ---------- .env loader ----------

export interface DotEnv {
  E2B_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  [key: string]: string | undefined;
}

/**
 * Parse .env file from project root.
 * Prefers .env values over process.env — critical because Claude Code sets
 * ANTHROPIC_BASE_URL to a local proxy unreachable from inside E2B sandbox.
 */
export function loadDotEnv(): DotEnv {
  const result: DotEnv = {};
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return result;

  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    result[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return result;
}

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

  /** Collect all text event chunks since cursor, optionally filtered by request_id */
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

  // ---------- Command helpers ----------

  async send(cmd: SandboxCommand): Promise<void> {
    if (!this.client) throw new Error("Harness not started");
    await this.client.sendCommand(cmd);
  }

  /**
   * Reset cursor, send a chat command with auto-generated request_id,
   * and wait for the corresponding result event.
   */
  async chatAndWaitResult(
    message: string,
    opts?: { target?: string; timeoutMs?: number; requestId?: string },
  ): Promise<EventOfType<"result"> & { _request_id: string }> {
    const requestId = opts?.requestId ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.resetCursor();
    await this.send({
      cmd: "chat",
      message,
      target: opts?.target,
      request_id: requestId,
    });
    const result = await this.waitForEvent(
      "result",
      opts?.timeoutMs ?? 60_000,
      (e) => e.request_id === requestId,
    );
    return Object.assign(result, { _request_id: requestId });
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
