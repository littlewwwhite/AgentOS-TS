import { describe, expect, test } from "bun:test";
import { approvedStoryboardPathForEpisode, approvedStoryboardPathFromAnyPath, episodeRuntimeDirForStoryboardPath } from "../src/lib/storyboardPaths";
import { clipVideoPath } from "../src/lib/storyboard";
import { episodePreviewPathForStoryboard } from "../src/serverUtils";

describe("storyboard canonical paths", () => {
  test("derives dedicated approved storyboard path from episode id", () => {
    expect(approvedStoryboardPathForEpisode("ep001")).toBe("output/storyboard/approved/ep001_storyboard.json");
  });

  test("maps legacy runtime export storyboard to approved canonical path", () => {
    expect(approvedStoryboardPathFromAnyPath("output/ep001/ep001_storyboard.json")).toBe(
      "output/storyboard/approved/ep001_storyboard.json",
    );
  });

  test("keeps approved storyboard media rooted at output/epNNN", () => {
    const approved = "output/storyboard/approved/ep001_storyboard.json";
    expect(episodeRuntimeDirForStoryboardPath(approved)).toBe("output/ep001");
    expect(clipVideoPath(approved, "scn_001", "clip_002")).toBe(
      "output/ep001/scn001/ep001_scn001_clip002.mp4",
    );
    expect(episodePreviewPathForStoryboard(approved)).toBe("output/ep001/ep001.mp4");
  });
});
