// input: scanWorkspaceChanges + publishArtifacts under test
// output: Verified file scanning and artifact registration behavior
// pos: Unit tests for auto-publish module — workspace change detection & Viking registration

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishArtifacts, scanWorkspaceChanges } from "../src/viking/auto-publish.js";
import type { VikingClient } from "../src/viking/client.js";

// ---------- scanWorkspaceChanges ----------

describe("scanWorkspaceChanges", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "viking-scan-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns files modified since the given timestamp", async () => {
    const past = Date.now() - 60_000;
    // Create files — their mtime will be "now", well after `past`
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "hello");
    fs.mkdirSync(path.join(tmpDir, "sub"));
    fs.writeFileSync(path.join(tmpDir, "sub", "b.txt"), "world");

    const files = await scanWorkspaceChanges(tmpDir, past);

    expect(files).toContain(path.join(tmpDir, "a.txt"));
    expect(files).toContain(path.join(tmpDir, "sub", "b.txt"));
  });

  it("skips hidden files, node_modules, .db, and .sqlite files", async () => {
    const past = Date.now() - 60_000;
    fs.writeFileSync(path.join(tmpDir, ".hidden"), "secret");
    fs.writeFileSync(path.join(tmpDir, "data.db"), "binary");
    fs.writeFileSync(path.join(tmpDir, "data.sqlite"), "binary");
    fs.mkdirSync(path.join(tmpDir, "node_modules"));
    fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg.js"), "module");
    fs.mkdirSync(path.join(tmpDir, ".git"));
    fs.writeFileSync(path.join(tmpDir, ".git", "HEAD"), "ref");
    // One legitimate file
    fs.writeFileSync(path.join(tmpDir, "good.txt"), "ok");

    const files = await scanWorkspaceChanges(tmpDir, past);

    expect(files).toEqual([path.join(tmpDir, "good.txt")]);
  });

  it("returns empty array for nonexistent directory", async () => {
    const files = await scanWorkspaceChanges("/nonexistent/path/xyz", 0);
    expect(files).toEqual([]);
  });

  it("respects maxDepth parameter", async () => {
    const past = Date.now() - 60_000;
    // depth 1
    fs.writeFileSync(path.join(tmpDir, "root.txt"), "r");
    // depth 2
    fs.mkdirSync(path.join(tmpDir, "d1"));
    fs.writeFileSync(path.join(tmpDir, "d1", "level1.txt"), "1");
    // depth 3
    fs.mkdirSync(path.join(tmpDir, "d1", "d2"));
    fs.writeFileSync(path.join(tmpDir, "d1", "d2", "level2.txt"), "2");
    // depth 4 — should be excluded with maxDepth=3
    fs.mkdirSync(path.join(tmpDir, "d1", "d2", "d3"));
    fs.writeFileSync(path.join(tmpDir, "d1", "d2", "d3", "level3.txt"), "3");

    const files = await scanWorkspaceChanges(tmpDir, past, 3);

    expect(files).toContain(path.join(tmpDir, "root.txt"));
    expect(files).toContain(path.join(tmpDir, "d1", "level1.txt"));
    expect(files).toContain(path.join(tmpDir, "d1", "d2", "level2.txt"));
    expect(files).not.toContain(path.join(tmpDir, "d1", "d2", "d3", "level3.txt"));
  });

  it("excludes files older than sinceMs", async () => {
    const file = path.join(tmpDir, "old.txt");
    fs.writeFileSync(file, "old");
    // Set mtime to 2 minutes ago
    const twoMinAgo = new Date(Date.now() - 120_000);
    fs.utimesSync(file, twoMinAgo, twoMinAgo);

    const files = await scanWorkspaceChanges(tmpDir, Date.now() - 30_000);
    expect(files).toEqual([]);
  });
});

// ---------- publishArtifacts ----------

describe("publishArtifacts", () => {
  function mockClient(
    addResourceFn?: (path: string, options?: unknown) => Promise<unknown>,
  ): VikingClient {
    return {
      addResource: addResourceFn ?? vi.fn().mockResolvedValue({ uri: "ok", status: "indexed" }),
    } as unknown as VikingClient;
  }

  it("registers files with VikingClient and returns count", async () => {
    const addResource = vi.fn().mockResolvedValue({ uri: "ok", status: "indexed" });
    const client = mockClient(addResource);

    const count = await publishArtifacts(
      client,
      ["/workspace/img.png", "/workspace/video.mp4"],
      { producer: "art-director", summary: "Generated assets" },
    );

    expect(count).toBe(2);
    expect(addResource).toHaveBeenCalledTimes(2);
    expect(addResource).toHaveBeenCalledWith("/workspace/img.png", {
      reason: "[art-director] Generated assets",
      target: "viking://resources/artifacts/art-director/",
    });
    expect(addResource).toHaveBeenCalledWith("/workspace/video.mp4", {
      reason: "[art-director] Generated assets",
      target: "viking://resources/artifacts/art-director/",
    });
  });

  it("skips hidden files and returns partial count on errors", async () => {
    let callIdx = 0;
    const addResource = vi.fn().mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) return Promise.reject(new Error("server error"));
      return Promise.resolve({ uri: "ok", status: "indexed" });
    });
    const client = mockClient(addResource);

    const count = await publishArtifacts(
      client,
      ["/workspace/.hidden", "/workspace/fail.png", "/workspace/ok.txt"],
      { producer: "test", summary: "test" },
    );

    // .hidden skipped, fail.png fails, ok.txt succeeds => 1
    expect(count).toBe(1);
    // addResource called only for non-hidden files
    expect(addResource).toHaveBeenCalledTimes(2);
  });

  it("returns 0 for empty file list", async () => {
    const addResource = vi.fn();
    const client = mockClient(addResource);

    const count = await publishArtifacts(client, [], { producer: "x", summary: "y" });

    expect(count).toBe(0);
    expect(addResource).not.toHaveBeenCalled();
  });
});
