import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("AssetGalleryView chrome", () => {
  test("does not split actor images into separate face side and back cells", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/AssetGalleryView.tsx"),
      "utf-8",
    );

    expect(source).toContain("三视图");
    expect(source).not.toContain('label="正面"');
    expect(source).not.toContain('label="侧面"');
    expect(source).not.toContain('label="背面"');
    expect(source).not.toContain("头部特写");
  });

  test("shows editable actor generation prompts with regeneration actions", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/Viewer/views/AssetGalleryView.tsx"),
      "utf-8",
    );

    expect(source).toContain("生成提示词");
    expect(source).toContain("重新生成此状态");
    expect(source).toContain("three_view_prompts.0.prompt");
  });
});
