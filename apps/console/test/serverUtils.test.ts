import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { episodePreviewPathForStoryboard, safeResolve, walkTree, mimeFor } from "../src/serverUtils";

const FIX = "/tmp/console-serverutils-fix";

function setup() {
  rmSync(FIX, { recursive: true, force: true });
  mkdirSync(join(FIX, "a", "b"), { recursive: true });
  writeFileSync(join(FIX, "a", "b", "leaf.txt"), "hi");
  writeFileSync(join(FIX, "a", "top.json"), "{}");
  mkdirSync(join(FIX, "a", "draft"));
  writeFileSync(join(FIX, "a", "draft", "d.md"), "x");
}

describe("safeResolve", () => {
  setup();
  test("accepts path inside root", () => {
    expect(safeResolve(FIX, "a/top.json")).toBe(join(FIX, "a", "top.json"));
  });
  test("rejects traversal", () => {
    expect(() => safeResolve(FIX, "../etc/passwd")).toThrow();
  });
});

describe("walkTree", () => {
  setup();
  test("returns flat list with types", () => {
    const t = walkTree(join(FIX, "a"), { maxDepth: 2, includeDraft: false });
    const names = t.map((n) => n.path).sort();
    expect(names).toContain("top.json");
    expect(names).toContain("b");
    expect(names).toContain("b/leaf.txt");
    expect(names.some((n) => n.startsWith("draft"))).toBe(false);
  });
  test("includes draft when asked", () => {
    const t = walkTree(join(FIX, "a"), { maxDepth: 2, includeDraft: true });
    expect(t.some((n) => n.path === "draft/d.md")).toBe(true);
  });
});

describe("mimeFor", () => {
  test("known extensions", () => {
    expect(mimeFor("a/b.png")).toBe("image/png");
    expect(mimeFor("foo.mp4")).toBe("video/mp4");
    expect(mimeFor("x.json")).toBe("application/json");
  });
  test("console static asset extensions", () => {
    expect(mimeFor("dist/index.html")).toBe("text/html; charset=utf-8");
    expect(mimeFor("dist/assets/index.js")).toBe("text/javascript; charset=utf-8");
    expect(mimeFor("dist/assets/index.css")).toBe("text/css; charset=utf-8");
    expect(mimeFor("dist/assets/font.woff2")).toBe("font/woff2");
  });
  test("unknown defaults to octet-stream", () => {
    expect(mimeFor("x.xyz")).toBe("application/octet-stream");
    expect(mimeFor("noext")).toBe("application/octet-stream");
  });
});

describe("episodePreviewPathForStoryboard", () => {
  test("places merged preview beside a nested storyboard", () => {
    expect(episodePreviewPathForStoryboard("output/ep001/ep001_storyboard.json")).toBe(
      "output/ep001/ep001.mp4",
    );
  });

  test("supports legacy flat storyboard paths", () => {
    expect(episodePreviewPathForStoryboard("output/ep006_storyboard.json")).toBe(
      "output/ep006.mp4",
    );
  });
});
