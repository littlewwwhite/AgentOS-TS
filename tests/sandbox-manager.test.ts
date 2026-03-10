import { describe, expect, it } from "vitest";
import type { SandboxCommand, SandboxEvent } from "../src/protocol.js";
import {
  SandboxManager,
  type SandboxClientLike,
  type SandboxClientFactory,
  type SandboxEntry,
} from "../src/sandbox-manager.js";

class FakeSandboxClient implements SandboxClientLike {
  public sandboxId: string | null;
  public startCalls = 0;
  public destroyCalls = 0;
  public commands: SandboxCommand[] = [];
  public readonly entries: SandboxEntry[];
  public readonly textFiles = new Map<string, string>();
  public readonly binaryFiles = new Map<string, Uint8Array>();
  public readonly downloadUrls = new Map<string, string>();

  constructor(
    sandboxId: string,
    private readonly onEvent?: (event: SandboxEvent) => void,
  ) {
    this.sandboxId = sandboxId;
    this.entries = [
      {
        name: "workspace",
        path: "/workspace",
        type: "dir",
        size: 0,
      },
      {
        name: "script.md",
        path: "/workspace/script.md",
        type: "file",
        size: 24,
      },
    ];
    this.textFiles.set("/workspace/script.md", "# Draft\n\nHello world");
    this.binaryFiles.set("/workspace/frame.png", Uint8Array.from([1, 2, 3]));
    this.downloadUrls.set(
      "/workspace/frame.png",
      "https://sandbox.example/frame.png",
    );
  }

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }

  async sendCommand(cmd: SandboxCommand): Promise<void> {
    this.commands.push(cmd);
  }

  async listFiles(path: string): Promise<SandboxEntry[]> {
    return this.entries.filter((entry) => {
      if (entry.path === path) return true;
      return entry.path.startsWith(`${path}/`);
    });
  }

  async readFile(
    path: string,
    opts?: { format?: "text" | "bytes" },
  ): Promise<string | Uint8Array> {
    if (opts?.format === "bytes") {
      const file = this.binaryFiles.get(path);
      if (!file) throw new Error(`Missing binary file: ${path}`);
      return file;
    }

    const file = this.textFiles.get(path);
    if (!file) throw new Error(`Missing text file: ${path}`);
    return file;
  }

  async downloadUrl(path: string): Promise<string> {
    const url = this.downloadUrls.get(path);
    if (!url) throw new Error(`Missing download URL: ${path}`);
    return url;
  }

  emit(event: SandboxEvent): void {
    this.onEvent?.(event);
  }
}

describe("SandboxManager", () => {
  it("creates one sandbox client per project and records sandbox metadata", async () => {
    const clients: FakeSandboxClient[] = [];
    const factory: SandboxClientFactory = ({ onEvent }) => {
      const client = new FakeSandboxClient(`sbx_${clients.length + 1}`, onEvent);
      clients.push(client);
      return client;
    };

    const manager = new SandboxManager({ createClient: factory });

    const first = await manager.getOrCreate("project-alpha");
    const second = await manager.getOrCreate("project-alpha");

    expect(first.projectId).toBe("project-alpha");
    expect(second.sandboxId).toBe("sbx_1");
    expect(clients).toHaveLength(1);
    expect(clients[0]?.startCalls).toBe(1);
    expect(manager.list()).toHaveLength(1);
  });

  it("broadcasts sandbox events to attached listeners", async () => {
    const clients: FakeSandboxClient[] = [];
    const manager = new SandboxManager({
      createClient: ({ onEvent }) => {
        const client = new FakeSandboxClient("sbx_events", onEvent);
        clients.push(client);
        return client;
      },
    });

    const events: SandboxEvent[] = [];
    const detach = await manager.attach("project-alpha", (event) => {
      events.push(event);
    });

    clients[0]?.emit({ type: "text", text: "Hello" });
    detach();
    clients[0]?.emit({ type: "text", text: "Ignored" });

    expect(events).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("forwards commands and file access to the project sandbox", async () => {
    const manager = new SandboxManager({
      createClient: ({ onEvent }) => new FakeSandboxClient("sbx_io", onEvent),
    });

    await manager.sendCommand("project-alpha", { cmd: "status" });

    const project = manager.get("project-alpha");
    expect(project?.sandboxId).toBe("sbx_io");

    const text = await manager.readTextFile("project-alpha", "/workspace/script.md");
    const bytes = await manager.readBinaryFile("project-alpha", "/workspace/frame.png");
    const url = await manager.getDownloadUrl("project-alpha", "/workspace/frame.png");

    expect(text).toContain("Hello world");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(url).toBe("https://sandbox.example/frame.png");
  });

  it("destroys project sandboxes and removes metadata", async () => {
    let client: FakeSandboxClient | undefined;
    const manager = new SandboxManager({
      createClient: ({ onEvent }) => {
        client = new FakeSandboxClient("sbx_destroy", onEvent);
        return client;
      },
    });

    await manager.getOrCreate("project-alpha");
    await manager.destroy("project-alpha");

    expect(client?.destroyCalls).toBe(1);
    expect(manager.get("project-alpha")).toBeNull();
  });
});
