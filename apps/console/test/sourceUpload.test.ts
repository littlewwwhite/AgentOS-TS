import { describe, expect, test } from "bun:test";
import {
  buildSourceUploadTargets,
  isTextSourceUpload,
  sanitizeUploadFilename,
} from "../src/lib/sourceUpload";

describe("source upload policy", () => {
  test("sanitizes uploaded filenames before placing them in the workspace", () => {
    expect(sanitizeUploadFilename("../../恶意/../小说:第一版?.txt")).toBe("小说_第一版_.txt");
    expect(sanitizeUploadFilename("   ")).toBe("source.txt");
  });

  test("mirrors text-like uploads to source.txt so the pipeline has a canonical input", () => {
    expect(isTextSourceUpload("story.md", "text/markdown")).toBe(true);
    expect(isTextSourceUpload("novel.txt", "text/plain")).toBe(true);
    expect(isTextSourceUpload("novel.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);

    expect(buildSourceUploadTargets("story.md", "text/markdown")).toEqual({
      rawPath: "input/story.md",
      sourcePath: "source.txt",
    });
  });

  test("keeps binary office uploads only in input/ until a converter normalizes them", () => {
    expect(buildSourceUploadTargets(
      "story.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )).toEqual({
      rawPath: "input/story.docx",
      sourcePath: undefined,
    });
  });
});
