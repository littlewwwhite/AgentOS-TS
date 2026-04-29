import { describe, expect, test } from "bun:test";
import { resolveVideoReviewStoryboardPath } from "../src/lib/videoReview";

describe("resolveVideoReviewStoryboardPath", () => {
  test("finds runtime storyboard inside an episode directory first", () => {
    expect(resolveVideoReviewStoryboardPath({
      videoDir: "output/ep001",
      treePaths: new Set([
        "output/ep001/ep001_storyboard.json",
        "output/storyboard/approved/ep001_storyboard.json",
      ]),
      stateStoryboardPath: "output/storyboard/approved/ep001_storyboard.json",
    })).toBe("output/ep001/ep001_storyboard.json");
  });

  test("falls back to state storyboard artifact", () => {
    expect(resolveVideoReviewStoryboardPath({
      videoDir: "output/ep001",
      treePaths: new Set(["output/storyboard/approved/ep001_storyboard.json"]),
      stateStoryboardPath: "output/storyboard/approved/ep001_storyboard.json",
    })).toBe("output/storyboard/approved/ep001_storyboard.json");
  });

  test("returns null when no storyboard exists", () => {
    expect(resolveVideoReviewStoryboardPath({
      videoDir: "output/ep001",
      treePaths: new Set(["output/ep001/scn001/clip001/a.mp4"]),
    })).toBeNull();
  });
});
