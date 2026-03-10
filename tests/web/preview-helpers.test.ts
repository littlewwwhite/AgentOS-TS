import { describe, expect, it } from "vitest";
import {
  getPreviewKind,
  getLeafName,
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

  it("marks only text and json previews as fragment-code compatible", () => {
    expect(shouldUseFragmentCode("text")).toBe(true);
    expect(shouldUseFragmentCode("json")).toBe(true);
    expect(shouldUseFragmentCode("markdown")).toBe(false);
    expect(shouldUseFragmentCode("image")).toBe(false);
  });

  it("extracts the leaf name from unix and windows paths", () => {
    expect(getLeafName("/workspace/src/main.ts")).toBe("main.ts");
    expect(getLeafName("C:\\workspace\\src\\main.ts")).toBe("main.ts");
    expect(getLeafName(null)).toBe("No file selected");
  });
});
