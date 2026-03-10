import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/session-store.js";

describe("SessionStore", () => {
  it("creates a new project session with null sandbox id", () => {
    const store = new SessionStore();

    const session = store.upsert("project-alpha");

    expect(session.projectId).toBe("project-alpha");
    expect(session.sandboxId).toBeNull();
    expect(typeof session.createdAt).toBe("number");
    expect(typeof session.updatedAt).toBe("number");
    expect(store.get("project-alpha")).toEqual(session);
  });

  it("preserves createdAt and updates sandbox metadata in place", async () => {
    const store = new SessionStore();
    const first = store.upsert("project-alpha");

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = store.upsert("project-alpha", { sandboxId: "sbx_123" });

    expect(second.projectId).toBe("project-alpha");
    expect(second.sandboxId).toBe("sbx_123");
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
});
