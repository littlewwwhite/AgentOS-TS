import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentTimeline } from "../src/components/Viewer/review/SegmentTimeline";

describe("SegmentTimeline", () => {
  test("renders total time, selected segment, and clip duration", () => {
    const html = renderToStaticMarkup(
      React.createElement(SegmentTimeline, {
        projectName: "demo",
        clips: [
          {
            key: "scn_001::clip_001",
            sceneId: "scn_001",
            sceneIndex: 0,
            clipId: "clip_001",
            clipIndex: 0,
            videoPath: "output/ep001/scn001/clip001/ep001_scn001_clip001.mp4",
            expectedDuration: null,
            totalDuration: 15,
            startOffset: 0,
            endOffset: 15,
            shotCount: 3,
            displayText: "片段一",
            shots: [],
          },
        ],
        currentClipKey: "scn_001::clip_001",
        availablePaths: new Set(["output/ep001/scn001/clip001/ep001_scn001_clip001.mp4"]),
        episodeTime: 0,
        totalDuration: 72,
        onSelectClip: () => undefined,
      }),
    );

    expect(html).toContain("按时间线播放");
    expect(html).toContain("00:00 / 01:12");
    expect(html).toContain("片段 1");
    expect(html).toContain("00:15");
    expect(html).toContain("aria-current=\"true\"");
  });
});
