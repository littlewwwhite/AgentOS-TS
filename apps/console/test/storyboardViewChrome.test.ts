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

  test("renders storyboard draft files without a duplicate prompt editor", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/StoryboardView.tsx"),
      "utf-8",
    );

    expect(source).toContain("故事板草稿");
    expect(source).not.toContain("结构保护");
    expect(source).not.toContain("故事板 prompt / 可编辑");
    expect(source).not.toContain("shots.${partIndex}.prompt");
  });

  test("does not split one video prompt into shot and beat field editors", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/StoryboardView.tsx"),
      "utf-8",
    );

    expect(source).not.toContain("PromptJsonField");
    expect(source).not.toContain("PromptBeatEditor");
    expect(source).not.toContain("PromptShotEditor");
  });

  test("presents storyboard json as the pre-video production plan", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/StoryboardView.tsx"),
      "utf-8",
    );

    expect(source).toContain("视频生成前");
    expect(source).toContain("故事板");
    expect(source).not.toContain("分镜脚本");
    expect(source).not.toContain("分镜文件");
    expect(source).not.toContain("PR 工作台模式");
  });

  test("does not use video-first wording on the storyboard primary surface", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/StoryboardView.tsx"),
      "utf-8",
    );

    expect(source).toContain("生成视频 prompt");
    expect(source).not.toContain("剧本到故事板");
    expect(source).not.toContain("来源剧本");
    expect(source).not.toContain("视频状态");
    expect(source).not.toContain("生成单元");
    expect(source).not.toContain("剧本摘录");
    expect(source).not.toContain("镜头结果");
    expect(source).not.toContain("每组展示一次视频生成结果");
    expect(source).not.toContain("故事板视频");
    expect(source).not.toContain("当前片段");
  });
});
