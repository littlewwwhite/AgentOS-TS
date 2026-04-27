import { describe, expect, test } from "bun:test";
import { buildEpisodeSubStages } from "../src/lib/episodeSubStages";
import type { EpisodeState } from "../src/types";

describe("buildEpisodeSubStages", () => {
  test("returns one row per MVP per-episode stage with status and path", () => {
    const ep: EpisodeState = {
      storyboard: { status: "completed", artifact: "output/storyboard/approved/ep001_storyboard.json" },
      video: { status: "running" },
    };

    const rows = buildEpisodeSubStages("ep001", ep);

    expect(rows).toEqual([
      {
        stage: "STORYBOARD",
        label: "故事板",
        status: "completed",
        path: "output/storyboard/approved/ep001_storyboard.json",
        title: "ep001/故事板",
      },
      {
        stage: "VIDEO",
        label: "视频",
        status: "running",
        path: "output/ep001",
        title: "ep001/视频",
      },
    ]);
  });

  test("falls back to not_started when episode has no per-stage entry", () => {
    const rows = buildEpisodeSubStages("ep002", undefined);
    expect(rows.map((row) => row.status)).toEqual(["not_started", "not_started"]);
    expect(rows.map((row) => row.stage)).toEqual(["STORYBOARD", "VIDEO"]);
  });

  test("uses default storyboard path when artifact missing", () => {
    const ep: EpisodeState = { storyboard: { status: "not_started" } };
    const rows = buildEpisodeSubStages("ep003", ep);
    const sb = rows.find((row) => row.stage === "STORYBOARD")!;
    expect(sb.path).toBe("output/storyboard/draft/ep003_storyboard.json");
  });

  test("handles partial state where storyboard is done but video missing", () => {
    const ep: EpisodeState = {
      storyboard: { status: "completed", artifact: "output/storyboard/approved/ep004_storyboard.json" },
    };
    const rows = buildEpisodeSubStages("ep004", ep);
    expect(rows.map((row) => ({ stage: row.stage, status: row.status }))).toEqual([
      { stage: "STORYBOARD", status: "completed" },
      { stage: "VIDEO", status: "not_started" },
    ]);
  });
});
