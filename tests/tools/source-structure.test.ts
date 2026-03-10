import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  detectSourceStructureFromText,
  detectSourceStructureProject,
} from "../../src/tools/source-structure.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  }
});

describe("detectSourceStructureFromText", () => {
  it("reuses explicit chapter markers when numbering is continuous", () => {
    const result = detectSourceStructureFromText(`
第1章 初见
林雪第一次见到沈砚，心里发慌。

第2章 对赌
她被迫签下对赌协议，却开始反击。
`.trim());

    expect(result.strategy).toBe("explicit_markers");
    expect(result.source_mode).toBe("authoritative_segments");
    expect(result.segments).toHaveLength(2);
    expect(result.segments.map((segment) => segment.title)).toEqual(["第1章 初见", "第2章 对赌"]);
  });

  it("groups scene markers by episode when explicit chapter markers are absent", () => {
    const result = detectSourceStructureFromText(`
1-1 日 内 办公室
人物：林雪
▲林雪合上文件。

1-2 夜 外 停车场
人物：林雪、沈砚
▲沈砚拦住她。

2-1 日 内 会议室
人物：林雪、董事们
▲投影亮起。
`.trim());

    expect(result.strategy).toBe("scene_markers");
    expect(result.source_mode).toBe("authoritative_segments");
    expect(result.segments).toHaveLength(2);
    expect(result.segments.map((segment) => segment.source_episode)).toEqual([1, 2]);
  });

  it("falls back to chunking when no reliable structure exists", () => {
    const result = detectSourceStructureFromText(
      "这是一个没有显式分章的长文本。".repeat(120),
      { maxCharsPerSegment: 120 },
    );

    expect(result.strategy).toBe("chunk_fallback");
    expect(result.source_mode).toBe("fallback_chunks");
    expect(result.segments.length).toBeGreaterThan(1);
  });

  it("splits oversized authoritative segments but preserves parent segment identity", () => {
    const longSegment = "她反复想起那场婚礼。".repeat(80);
    const result = detectSourceStructureFromText(
      `
第1章 婚礼
${longSegment}

第2章 反击
她终于决定反击。
`.trim(),
      { maxCharsPerSegment: 160 },
    );

    expect(result.strategy).toBe("explicit_markers");
    expect(result.source_mode).toBe("authoritative_segments");
    expect(result.segments.length).toBeGreaterThan(2);
    expect(result.segments.some((segment) => segment.parent_segment_id === "seg_001")).toBe(true);
  });
});

describe("detectSourceStructureProject", () => {
  it("writes draft/source-structure.json into the project directory", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "source-structure-"));
    const projectPath = path.join(tmpDir, "novel");
    const draftPath = path.join(projectPath, "draft");

    await fs.mkdir(draftPath, { recursive: true });
    await fs.writeFile(
      path.join(projectPath, "source.txt"),
      `
第1章 初见
林雪第一次见到沈砚。

第2章 对赌
她开始布局反击。
`.trim(),
      "utf-8",
    );

    const result = await detectSourceStructureProject(projectPath);
    const saved = JSON.parse(
      await fs.readFile(path.join(projectPath, "draft", "source-structure.json"), "utf-8"),
    );

    expect(result.project_path).toBe(projectPath);
    expect(result.output_path).toBe(path.join(projectPath, "draft", "source-structure.json"));
    expect(saved.strategy).toBe("explicit_markers");
    expect(saved.segments).toHaveLength(2);
  });
});
