import { describe, expect, test } from "bun:test";
import { fileUrl } from "../src/lib/fileUrl";
import { detectSchema } from "../src/lib/schemaDetect";

describe("fileUrl", () => {
  test("encodes path segments but keeps slashes", () => {
    expect(fileUrl("c3-1", "output/ep001/clip 1.mp4")).toBe(
      "/files/c3-1/output/ep001/clip%201.mp4",
    );
  });
  test("trims leading slash", () => {
    expect(fileUrl("c0", "/output/script.json")).toBe("/files/c0/output/script.json");
  });
});

describe("detectSchema", () => {
  test("script: has episodes array", () => {
    expect(detectSchema({ episodes: [{ scenes: [] }] })).toBe("script");
  });
  test("storyboard: scenes with shots+prompt", () => {
    expect(detectSchema({ episode_id: "ep001", scenes: [{ shots: [{ prompt: "x" }] }] })).toBe("storyboard");
  });
  test("inspiration: has inspiration_id or brief", () => {
    expect(detectSchema({ brief: "x", topics: [] })).toBe("inspiration");
  });
  test("fallback: unknown", () => {
    expect(detectSchema({ foo: 1 })).toBe("generic");
  });
  test("non-object returns generic", () => {
    expect(detectSchema(null)).toBe("generic");
    expect(detectSchema([1, 2])).toBe("generic");
  });
  test("script wins when both episodes and scenes are top-level", () => {
    expect(detectSchema({ episodes: [{ scenes: [] }], scenes: [{ shots: [{ prompt: "x" }] }] })).toBe("script");
  });
});
