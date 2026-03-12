import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/session-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createStoreFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-session-store-"));
  tempDirs.push(dir);
  return path.join(dir, "sessions.db");
}

describe("SessionStore", () => {
  it("creates a new project session with null sandbox id", () => {
    const store = new SessionStore();

    const session = store.upsert("project-alpha");

    expect(session.projectId).toBe("project-alpha");
    expect(session.sandboxId).toBeNull();
    expect(session.agentSessionIds).toEqual({});
    expect(session.activeAgent).toBeNull();
    expect(typeof session.createdAt).toBe("number");
    expect(typeof session.updatedAt).toBe("number");
    expect(store.get("project-alpha")).toEqual(session);
  });

  it("preserves createdAt and updates sandbox metadata in place", async () => {
    const store = new SessionStore();
    const first = store.upsert("project-alpha");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = store.upsert("project-alpha", {
      sandboxId: "sbx_123",
      agentSessionIds: { main: "sess-main" },
      activeAgent: "main",
    });

    expect(second.projectId).toBe("project-alpha");
    expect(second.sandboxId).toBe("sbx_123");
    expect(second.agentSessionIds).toEqual({ main: "sess-main" });
    expect(second.activeAgent).toBe("main");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });

  it("lists and deletes project sessions", () => {
    const store = new SessionStore();
    store.upsert("project-alpha");
    store.upsert("project-beta", { sandboxId: "sbx_beta" });

    expect(store.list().map((session) => session.projectId)).toEqual([
      "project-beta",
      "project-alpha",
    ]);

    expect(store.delete("project-alpha")).toBe(true);
    expect(store.get("project-alpha")).toBeNull();
    expect(store.delete("missing-project")).toBe(false);
  });

  it("persists sessions to SQLite when file backing is enabled", () => {
    const filePath = createStoreFile();
    const store = new SessionStore({ filePath });

    store.upsert("project-alpha", {
      sandboxId: "sbx_saved",
      ownerId: "user-1",
      agentSessionIds: {
        main: "sess-main",
        screenwriter: "sess-screenwriter",
      },
      activeAgent: "screenwriter",
    });
    store.close();

    // Re-open from same file — data should survive
    const store2 = new SessionStore({ filePath });
    const restored = store2.get("project-alpha");

    expect(restored).toEqual({
      projectId: "project-alpha",
      sandboxId: "sbx_saved",
      ownerId: "user-1",
      agentSessionIds: {
        main: "sess-main",
        screenwriter: "sess-screenwriter",
      },
      activeAgent: "screenwriter",
      createdAt: restored!.createdAt,
      updatedAt: restored!.updatedAt,
    });
    store2.close();
  });

  it("preserves host-side agent session metadata", () => {
    const store = new SessionStore();

    const session = store.upsert("project-alpha", {
      ownerId: "user-1",
      agentSessionIds: {
        main: "sess-main",
        screenwriter: "sess-screenwriter",
      },
      activeAgent: "screenwriter",
    });

    expect(session.ownerId).toBe("user-1");
    expect(session.agentSessionIds).toEqual({
      main: "sess-main",
      screenwriter: "sess-screenwriter",
    });
    expect(session.activeAgent).toBe("screenwriter");
  });

  it("removes deleted sessions from SQLite when file backing is enabled", () => {
    const filePath = createStoreFile();
    const store = new SessionStore({ filePath });
    store.upsert("project-alpha", { sandboxId: "sbx_saved" });

    expect(store.delete("project-alpha")).toBe(true);
    store.close();

    const store2 = new SessionStore({ filePath });
    expect(store2.list()).toEqual([]);
    store2.close();
  });

  it("cascades delete to agent_sessions", () => {
    const store = new SessionStore();
    store.upsert("project-alpha", {
      agentSessionIds: { main: "sess-main", writer: "sess-writer" },
    });

    expect(store.getAgentSessions("project-alpha")).toEqual({
      main: "sess-main",
      writer: "sess-writer",
    });

    store.delete("project-alpha");
    expect(store.getAgentSessions("project-alpha")).toEqual({});
  });

  // -- Agent session methods --

  it("get/set agent sessions independently of upsert", () => {
    const store = new SessionStore();
    store.upsert("project-alpha");

    store.setAgentSessions("project-alpha", {
      main: "sess-1",
      writer: "sess-2",
    });

    expect(store.getAgentSessions("project-alpha")).toEqual({
      main: "sess-1",
      writer: "sess-2",
    });

    // Overwrite
    store.setAgentSessions("project-alpha", { main: "sess-3" });
    expect(store.getAgentSessions("project-alpha")).toEqual({
      main: "sess-3",
    });
  });

  // -- User persistence --

  it("persists and finds users by token", () => {
    const store = new SessionStore();

    store.persistUser({
      userId: "guest_abc",
      token: "tok_xyz",
      createdAt: 1000,
      expiresAt: 2000,
    });

    const found = store.findUserByToken("tok_xyz");
    expect(found).toEqual({ userId: "guest_abc", expiresAt: 2000 });

    expect(store.findUserByToken("nonexistent")).toBeNull();
  });

  it("replaces user on conflict", () => {
    const store = new SessionStore();

    store.persistUser({
      userId: "guest_abc",
      token: "tok_1",
      createdAt: 1000,
      expiresAt: 2000,
    });

    // Same userId, new token
    store.persistUser({
      userId: "guest_abc",
      token: "tok_2",
      createdAt: 1500,
      expiresAt: 3000,
    });

    expect(store.findUserByToken("tok_1")).toBeNull();
    expect(store.findUserByToken("tok_2")).toEqual({
      userId: "guest_abc",
      expiresAt: 3000,
    });
  });

  // -- Edge cases --

  it("get returns null for nonexistent project", () => {
    const store = new SessionStore();
    expect(store.get("nonexistent")).toBeNull();
  });

  it("upsert can set sandboxId to null to clear it", () => {
    const store = new SessionStore();
    store.upsert("project-alpha", { sandboxId: "sbx_123" });

    const cleared = store.upsert("project-alpha", { sandboxId: null });
    expect(cleared.sandboxId).toBeNull();
  });

  it("upsert preserves existing agentSessionIds when patch omits them", () => {
    const store = new SessionStore();
    store.upsert("project-alpha", {
      agentSessionIds: { main: "sess-main" },
    });

    // Update only sandboxId — agentSessionIds should be untouched
    const updated = store.upsert("project-alpha", { sandboxId: "sbx_1" });
    expect(updated.agentSessionIds).toEqual({ main: "sess-main" });
  });

  it("user persistence survives DB close and reopen", () => {
    const filePath = createStoreFile();
    const store = new SessionStore({ filePath });

    store.persistUser({
      userId: "guest_persist",
      token: "tok_persist",
      createdAt: 1000,
      expiresAt: 99999,
    });
    store.close();

    const store2 = new SessionStore({ filePath });
    const found = store2.findUserByToken("tok_persist");
    expect(found).toEqual({ userId: "guest_persist", expiresAt: 99999 });
    store2.close();
  });

  it("normalizes non-string values out of agentSessionIds", () => {
    const store = new SessionStore();
    const session = store.upsert("project-alpha", {
      agentSessionIds: {
        main: "valid",
        broken: 123 as unknown as string,
        nope: null as unknown as string,
      },
    });

    expect(session.agentSessionIds).toEqual({ main: "valid" });
  });
});
