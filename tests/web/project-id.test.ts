import { describe, expect, it } from "vitest";
import {
  PROJECT_ID_STORAGE_KEY,
  resolveProjectId,
} from "../../web/lib/project-id";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("resolveProjectId", () => {
  it("prefers the explicit environment project id", () => {
    const storage = new MemoryStorage();

    const projectId = resolveProjectId("project-from-env", storage, () => "tmp-123");

    expect(projectId).toBe("project-from-env");
    expect(storage.getItem(PROJECT_ID_STORAGE_KEY)).toBeNull();
  });

  it("creates a temporary project id instead of demo-project", () => {
    const projectId = resolveProjectId(undefined, new MemoryStorage(), () => "tmp-123");

    expect(projectId).toBe("tmp-123");
    expect(projectId).not.toBe("demo-project");
  });

  it("reuses the same temporary project id within one browser session", () => {
    const storage = new MemoryStorage();

    const first = resolveProjectId(undefined, storage, () => "tmp-123");
    const second = resolveProjectId(undefined, storage, () => "tmp-456");

    expect(first).toBe("tmp-123");
    expect(second).toBe("tmp-123");
  });
});
