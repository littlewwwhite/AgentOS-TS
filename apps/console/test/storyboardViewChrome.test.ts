import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("StoryboardView chrome", () => {
  test("does not render redundant playback and segment metadata labels", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/StoryboardView.tsx"),
      "utf-8",
    );

    expect(source).not.toContain("当前段元信息");
    expect(source).not.toContain("整集成片");
    expect(source).not.toContain('label="scene"');
    expect(source).not.toContain('label="clip"');
    expect(source).not.toContain('label="status"');
    expect(source).not.toContain('label="当前游标"');
    expect(source).not.toContain('label="游标"');
    expect(source).not.toContain('label="片段时长"');
    expect(source).not.toContain('label="预览"');
    expect(source).not.toContain('title="预览模式"');
  });

  test("renders storyboard draft files through a structure-preserving editor", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/StoryboardView.tsx"),
      "utf-8",
    );

    expect(source).toContain("分镜草稿");
    expect(source).toContain("结构保护");
    expect(source).toContain("shots.${partIndex}.prompt");
  });
});
