import { describe, expect, test } from "bun:test";
import { resolveReviewArtifactPath, resolveView } from "../src/components/Viewer/resolveView";

describe("resolveView", () => {
  test("empty path → overview", () => {
    expect(resolveView("")).toBe("overview");
  });
  test("script.json → script (by path heuristic)", () => {
    expect(resolveView("output/script.json")).toBe("script");
  });
  test("storyboard.json → storyboard", () => {
    expect(resolveView("output/ep001/ep001_storyboard.json")).toBe("storyboard");
    expect(resolveView("output/storyboard/draft/ep001_storyboard.json")).toBe("storyboard");
    expect(resolveView("output/storyboard/approved/ep001_storyboard.json")).toBe("storyboard");
  });
  test("legacy draft storyboard shots → storyboard rendered editor", () => {
    expect(resolveView("draft/storyboard/ep001.shots.json")).toBe("storyboard");
    expect(resolveView("output/storyboard/draft/ep001_storyboard.json")).toBe("storyboard");
    expect(resolveView("storyboard/ep001.shots.json")).toBe("storyboard");
  });
  test("paused inspiration artifact renders as plain json", () => {
    expect(resolveView("output/inspiration.json")).toBe("json");
  });
  test("actors/ dir → asset-gallery", () => {
    expect(resolveView("output/actors")).toBe("asset-gallery");
    expect(resolveView("output/locations")).toBe("asset-gallery");
    expect(resolveView("output/props")).toBe("asset-gallery");
  });
  test("ep001/ dir → video review grid", () => {
    expect(resolveView("output/ep001")).toBe("video-grid");
    expect(resolveReviewArtifactPath("output/ep001")).toBe("output/ep001");
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
