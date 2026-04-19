import { describe, expect, test } from "bun:test";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { safeResolve, walkTree } from "../src/serverUtils";

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
