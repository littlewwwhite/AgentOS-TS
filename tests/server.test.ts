import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { SandboxCommand, SandboxEvent } from "../src/protocol.js";
import type { ProjectSession } from "../src/session-store.js";
import { issueGuestSession, scopeProjectId } from "../src/auth.js";
import {
  startAgentOsServer,
  type HostBridgeManager,
} from "../src/server.js";

class FakeBridgeManager implements HostBridgeManager {
  public readonly sessions = new Map<string, ProjectSession>();
  public readonly listeners = new Map<string, Set<(event: SandboxEvent) => void>>();
  public readonly commands: Array<{ projectId: string; cmd: SandboxCommand }> = [];
  public readonly writes: Array<{ projectId: string; path: string; content: string }> = [];
  public readonly uploads: Array<{
    projectId: string;
    path: string;
    content: string | Uint8Array | ArrayBuffer;
  }> = [];
  private nextSandboxId = 1;

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
      sandboxId: `sbx_runtime_${this.nextSandboxId++}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentSessionIds: {},
      activeAgent: null,
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

  async writeTextFile(projectId: string, path: string, content: string): Promise<void> {
    this.writes.push({ projectId, path, content });
  }

  async syncTextFiles(
    projectId: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<string[]> {
    for (const file of files) {
      this.writes.push({ projectId, path: file.path, content: file.content });
    }
    return files.map((file) => file.path);
  }

  async uploadFile(
    projectId: string,
    path: string,
    content: string | Uint8Array | ArrayBuffer,
  ): Promise<void> {
    this.uploads.push({ projectId, path, content });
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
  it("issues guest auth sessions and rejects unauthorized access", async () => {
    const manager = new FakeBridgeManager();
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
      authSecret: "test-secret",
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const auth = await fetch(`${baseUrl}/api/auth/session`, { method: "POST" });
    expect(auth.status).toBe(200);
    const session = await auth.json() as { userId: string; token: string };
    expect(session.userId).toContain("guest_");
    expect(typeof session.token).toBe("string");

    const unauthorized = await fetch(`${baseUrl}/api/projects`);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });
  });

  it("serves health and project lifecycle endpoints", async () => {
    const manager = new FakeBridgeManager();
    const authSession = issueGuestSession("test-secret");
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
      authSecret: "test-secret",
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: `Bearer ${authSession.token}` };

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const created = await fetch(`${baseUrl}/api/projects/project-alpha`, {
      method: "POST",
      headers,
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      projectId: "project-alpha",
      userId: authSession.userId,
    });

    const listed = await fetch(`${baseUrl}/api/projects`, { headers });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      expect.objectContaining({
        projectId: "project-alpha",
        userId: authSession.userId,
      }),
    ]);

    const deleted = await fetch(`${baseUrl}/api/projects/project-alpha`, {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
  });

  it("serves file tree, text reads, byte reads, and download redirects", async () => {
    const manager = new FakeBridgeManager();
    const authSession = issueGuestSession("test-secret");
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
      authSecret: "test-secret",
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: `Bearer ${authSession.token}` };

    const tree = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/tree?path=${encodeURIComponent("/workspace")}`,
      { headers },
    );
    expect(tree.status).toBe(200);
    const treePayload = await tree.json();
    expect(treePayload.entries).toHaveLength(2);

    const text = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/read?path=${encodeURIComponent("/workspace/script.md")}`,
      { headers },
    );
    expect(text.status).toBe(200);
    expect(await text.json()).toEqual({
      path: "/workspace/script.md",
      format: "text",
      content: "# Script\n\nHello world",
    });

    const bytes = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/read?path=${encodeURIComponent("/workspace/frame.png")}&format=bytes`,
      { headers },
    );
    expect(bytes.status).toBe(200);
    expect(await bytes.json()).toEqual({
      path: "/workspace/frame.png",
      format: "bytes",
      content: "AQID",
    });

    const download = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/download?path=${encodeURIComponent("/workspace/frame.png")}`,
      { redirect: "manual", headers },
    );
    expect(download.status).toBe(302);
    expect(download.headers.get("location")).toBe(
      "https://sandbox.example/frame.png",
    );
  });

  it("accepts text file writes and sync batches", async () => {
    const manager = new FakeBridgeManager();
    const authSession = issueGuestSession("test-secret");
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
      authSecret: "test-secret",
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const headers = {
      authorization: `Bearer ${authSession.token}`,
      "content-type": "application/json",
    };

    const write = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/write`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          path: "/workspace/source.txt",
          content: "draft",
        }),
      },
    );
    expect(write.status).toBe(200);
    expect(await write.json()).toEqual({
      ok: true,
      path: "/workspace/source.txt",
    });

    const sync = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/sync`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          files: [
            { path: "/workspace/a.txt", content: "A" },
            { path: "/workspace/b.txt", content: "B" },
          ],
        }),
      },
    );
    expect(sync.status).toBe(200);
    expect(await sync.json()).toEqual({
      ok: true,
      paths: ["/workspace/a.txt", "/workspace/b.txt"],
    });

    expect(manager.writes).toEqual([
      {
        projectId: scopeProjectId(authSession.userId, "project-alpha"),
        path: "/workspace/source.txt",
        content: "draft",
      },
      {
        projectId: scopeProjectId(authSession.userId, "project-alpha"),
        path: "/workspace/a.txt",
        content: "A",
      },
      {
        projectId: scopeProjectId(authSession.userId, "project-alpha"),
        path: "/workspace/b.txt",
        content: "B",
      },
    ]);
  });

  it("accepts upload requests for text and binary files", async () => {
    const manager = new FakeBridgeManager();
    const authSession = issueGuestSession("test-secret");
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
      authSecret: "test-secret",
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const headers = {
      authorization: `Bearer ${authSession.token}`,
      "content-type": "application/json",
    };

    const textUpload = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/upload`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          path: "/workspace/upload.txt",
          content: "hello upload",
        }),
      },
    );
    expect(textUpload.status).toBe(200);
    expect(await textUpload.json()).toEqual({
      ok: true,
      path: "/workspace/upload.txt",
      bytes: 12,
    });

    const binaryUpload = await fetch(
      `${baseUrl}/api/projects/project-alpha/files/upload`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          path: "/workspace/frame.png",
          contentBase64: "AQID",
        }),
      },
    );
    expect(binaryUpload.status).toBe(200);
    expect(await binaryUpload.json()).toEqual({
      ok: true,
      path: "/workspace/frame.png",
      bytes: 3,
    });

    expect(manager.uploads).toEqual([
      {
        projectId: scopeProjectId(authSession.userId, "project-alpha"),
        path: "/workspace/upload.txt",
        content: "hello upload",
      },
      {
        projectId: scopeProjectId(authSession.userId, "project-alpha"),
        path: "/workspace/frame.png",
        content: Uint8Array.from([1, 2, 3]),
      },
    ]);
  });

  it("bridges websocket commands and sandbox events", async () => {
    const manager = new FakeBridgeManager();
    const authSession = issueGuestSession("test-secret");
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
      authSecret: "test-secret",
    });
    servers.push(server);

    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/project-alpha?token=${encodeURIComponent(authSession.token)}`,
    );
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
        projectId: scopeProjectId(authSession.userId, "project-alpha"),
        cmd: { cmd: "chat", message: "hello" },
      },
    ]);
  });

  it("reuses user identity when existing token is sent to auth endpoint", async () => {
    const manager = new FakeBridgeManager();
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
      authSecret: "test-secret",
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;

    // First call: no token → new guest
    const first = await fetch(`${baseUrl}/api/auth/session`, { method: "POST" });
    const firstSession = await first.json() as { userId: string; token: string };

    // Second call: send existing token → same user
    const second = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${firstSession.token}` },
    });
    const secondSession = await second.json() as { userId: string; token: string };

    expect(secondSession.userId).toBe(firstSession.userId);
    expect(secondSession.token).toBe(firstSession.token);
  });

  it("issues new guest when expired token is sent to auth endpoint", async () => {
    const manager = new FakeBridgeManager();
    const server = await startAgentOsServer({
      manager,
      host: "127.0.0.1",
      port: 0,
      authSecret: "test-secret",
    });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;

    // Fabricate an expired token (1s TTL, already expired)
    const { issueGuestSession: issue } = await import("../src/auth.js");
    const expired = issue("test-secret", {
      now: Date.now() - 10_000,
      ttlMs: 1000,
    });

    const res = await fetch(`${baseUrl}/api/auth/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${expired.token}` },
    });
    const session = await res.json() as { userId: string; token: string };

    // Should be a different user
    expect(session.userId).not.toBe(expired.userId);
    expect(session.userId).toMatch(/^guest_/);
  });
});
