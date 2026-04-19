import { describe, expect, test } from "bun:test";
import { resolveView } from "../src/components/Viewer/resolveView";

describe("resolveView", () => {
  test("empty path → overview", () => {
    expect(resolveView("")).toBe("overview");
  });
  test("script.json → script (by path heuristic)", () => {
    expect(resolveView("output/script.json")).toBe("script");
  });
  test("storyboard.json → storyboard", () => {
    expect(resolveView("output/ep001/ep001_storyboard.json")).toBe("storyboard");
  });
  test("inspiration.json → inspiration", () => {
    expect(resolveView("output/inspiration.json")).toBe("inspiration");
  });
  test("actors/ dir → asset-gallery", () => {
    expect(resolveView("output/actors")).toBe("asset-gallery");
    expect(resolveView("output/locations")).toBe("asset-gallery");
    expect(resolveView("output/props")).toBe("asset-gallery");
  });
  test("ep001/ dir → video-grid", () => {
    expect(resolveView("output/ep001")).toBe("video-grid");
  });
  test("mp4 leaf → video", () => {
    expect(resolveView("output/ep001/scn001/clip001/v1.mp4")).toBe("video");
  });
  test("png leaf → image", () => {
    expect(resolveView("output/actors/hero/ref.png")).toBe("image");
  });
  test("srt → text", () => {
    expect(resolveView("output/ep001/subtitles.srt")).toBe("text");
  });
  test("unknown json → json", () => {
    expect(resolveView("foo.json")).toBe("json");
  });
  test("unknown → fallback", () => {
    expect(resolveView("random.xyz")).toBe("fallback");
  });
});
