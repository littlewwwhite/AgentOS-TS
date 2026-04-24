import { describe, expect, test } from "bun:test";
import { rollupEpisodeStatus } from "../src/lib/episodeStatus";

describe("rollupEpisodeStatus", () => {
  test("surfaces review and invalidation states before terminal success", () => {
    expect(rollupEpisodeStatus({
      storyboard: { status: "in_review" },
      video: { status: "completed" },
    })).toBe("in_review");

    expect(rollupEpisodeStatus({
      storyboard: { status: "approved" },
      video: { status: "stale" },
    })).toBe("stale");
  });

  test("treats mixed progress plus pending work as partial", () => {
    expect(rollupEpisodeStatus({
      storyboard: { status: "approved" },
      video: { status: "not_started" },
    })).toBe("partial");
  });

  test("preserves failure as highest-priority state", () => {
    expect(rollupEpisodeStatus({
      storyboard: { status: "approved" },
      video: { status: "failed" },
      editing: { status: "not_started" },
    })).toBe("failed");
  });
});
