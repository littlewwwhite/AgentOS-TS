import { describe, expect, it } from "vitest";
import {
  getPreviewKind,
  getLeafName,
  hasRenderedPreview,
  shouldUseFragmentCode,
} from "../../web/lib/preview";

describe("preview helpers", () => {
  it("classifies file extensions for preview routing", () => {
    expect(getPreviewKind(null)).toBe("empty");
    expect(getPreviewKind("/tmp/frame.png")).toBe("image");
    expect(getPreviewKind("/tmp/cut.mp4")).toBe("video");
    expect(getPreviewKind("/tmp/notes.md")).toBe("markdown");
    expect(getPreviewKind("/tmp/config.json")).toBe("json");
    expect(getPreviewKind("/tmp/main.tsx")).toBe("text");
  });

  it("keeps text-based files in FragmentCode, including markdown sources", () => {
    expect(shouldUseFragmentCode("text")).toBe(true);
    expect(shouldUseFragmentCode("json")).toBe(true);
    expect(shouldUseFragmentCode("markdown")).toBe(true);
    expect(shouldUseFragmentCode("image")).toBe(false);
    expect(shouldUseFragmentCode("video")).toBe(false);
  });

  it("marks rich preview kinds separately from code views", () => {
    expect(hasRenderedPreview("markdown")).toBe(true);
    expect(hasRenderedPreview("image")).toBe(true);
    expect(hasRenderedPreview("video")).toBe(true);
    expect(hasRenderedPreview("text")).toBe(false);
    expect(hasRenderedPreview("json")).toBe(false);
    expect(hasRenderedPreview("empty")).toBe(false);
  });

  it("extracts the leaf name from unix and windows paths", () => {
    expect(getLeafName("/workspace/src/main.ts")).toBe("main.ts");
    expect(getLeafName(String.raw`C:\workspace\src\main.ts`)).toBe("main.ts");
    expect(getLeafName(null)).toBe("No file selected");
  });
});
