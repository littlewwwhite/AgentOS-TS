import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { SandboxCommand, SandboxEvent } from "../src/protocol.js";
import type { ProjectSession } from "../src/session-store.js";
import {
  startAgentOsServer,
  type HostBridgeManager,
} from "../src/server.js";

class FakeBridgeManager implements HostBridgeManager {
  public readonly sessions = new Map<string, ProjectSession>();
  public readonly listeners = new Map<string, Set<(event: SandboxEvent) => void>>();
  public readonly commands: Array<{ projectId: string; cmd: SandboxCommand }> = [];

  list(): ProjectSession[] {
    return [...this.sessions.values()];
  }

  get(projectId: string): ProjectSession | null {
    return this.sessions.get(projectId) ?? null;
  }

  async getOrCreate(projectId: string): Promise<ProjectSession> {
    const existing = this.sessions.get(projectId);
    if (existing) return existing;

    const session: ProjectSession = {
      projectId,
      sandboxId: `sbx_${projectId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(projectId, session);
    return session;
  }

  async attach(
    projectId: string,
    listener: (event: SandboxEvent) => void,
  ): Promise<() => void> {
    await this.getOrCreate(projectId);
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    listener({ type: "ready", skills: ["screenwriter"] });

    return () => {
      listeners.delete(listener);
    };
  }

  async sendCommand(projectId: string, cmd: SandboxCommand): Promise<void> {
    this.commands.push({ projectId, cmd });
    const listeners = this.listeners.get(projectId);
    if (!listeners) return;

    if (cmd.cmd === "chat") {
      for (const listener of listeners) {
        listener({ type: "text", text: `echo:${cmd.message}` });
      }
    }
  }

  async destroy(projectId: string): Promise<void> {
    this.sessions.delete(projectId);
    this.listeners.delete(projectId);
  }

  async listFiles(_projectId: string, path: string): Promise<Array<{ name: string; path: string; type?: string; size?: number }>> {
    return [
      { name: "workspace", path, type: "dir", size: 0 },
      { name: "script.md", path: `${path}/script.md`, type: "file", size: 24 },
    ];
  }

  async readTextFile(_projectId: string): Promise<string> {
    return "# Script\n\nHello world";
  }

  async readBinaryFile(_projectId: string): Promise<Uint8Array> {
    return Uint8Array.from([1, 2, 3]);
  }

  async getDownloadUrl(_projectId: string): Promise<string> {
    return "https://sandbox.example/frame.png";
  }
}

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      await server.close();
    }
  }
});

describe("AgentOS host bridge server", () => {
  it("serves health and project lifecycle endpoints", async () => {
    const manager = new FakeBridgeManager();
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const created = await fetch(`${baseUrl}/api/projects/project-alpha`, {
      method: "POST",
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      projectId: "project-alpha",
      sandboxId: "sbx_project-alpha",
    });

    const listed = await fetch(`${baseUrl}/api/projects`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toHaveLength(1);

    const deleted = await fetch(`${baseUrl}/api/projects/project-alpha`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
  });

  it("serves file tree, text reads, byte reads, and download redirects", async () => {
    const manager = new FakeBridgeManager();
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;

    const tree = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/tree?path=${encodeURIComponent("/workspace")}`,
    );
    expect(tree.status).toBe(200);
    const treePayload = await tree.json();
    expect(treePayload.entries).toHaveLength(2);

    const text = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/read?path=${encodeURIComponent("/workspace/script.md")}`,
    );
    expect(text.status).toBe(200);
    expect(await text.json()).toEqual({
      path: "/workspace/script.md",
      format: "text",
      content: "# Script\n\nHello world",
    });

    const bytes = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/read?path=${encodeURIComponent("/workspace/frame.png")}&format=bytes`,
    );
    expect(bytes.status).toBe(200);
    expect(await bytes.json()).toEqual({
      path: "/workspace/frame.png",
      format: "bytes",
      content: "AQID",
    });

    const download = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/download?path=${encodeURIComponent("/workspace/frame.png")}`,
      { redirect: "manual" },
    );
    expect(download.status).toBe(302);
    expect(download.headers.get("location")).toBe(
      "https://sandbox.example/frame.png",
    );
  });

  it("bridges websocket commands and sandbox events", async () => {
    const manager = new FakeBridgeManager();
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
    });
    servers.push(server);

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws/project-alpha`);
    const messages: SandboxEvent[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for websocket messages"));
      }, 3000);

      socket.on("message", (raw) => {
        const event = JSON.parse(raw.toString()) as SandboxEvent;
        messages.push(event);
        if (event.type === "ready") {
          socket.send(JSON.stringify({ cmd: "chat", message: "hello" }));
        }
        if (event.type === "text") {
          clearTimeout(timer);
          resolve();
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    socket.close();

    expect(messages[0]).toEqual({ type: "ready", skills: ["screenwriter"] });
    expect(messages[1]).toEqual({ type: "text", text: "echo:hello" });
    expect(manager.commands).toEqual([
      {
        projectId: "project-alpha",
        cmd: { cmd: "chat", message: "hello" },
      },
    ]);
  });
});
