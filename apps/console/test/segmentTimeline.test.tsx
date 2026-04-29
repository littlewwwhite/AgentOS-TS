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
        onPlayAll: () => undefined,
        onInsertClipAfter: () => undefined,
      }),
    );

    expect(html).toContain("播放全部");
    expect(html).toContain("00:00 / 01:12");
    expect(html).toContain("片段 1");
    expect(html).toContain("00:15");
    expect(html).toContain("aria-current=\"true\"");
  });

  test("renders insertion controls between video segments", () => {
    const clips = [0, 1].map((index) => ({
      key: `scn_001::clip_00${index + 1}`,
      sceneId: "scn_001",
      sceneIndex: 0,
      clipId: `clip_00${index + 1}`,
      clipIndex: index,
      videoPath: `output/ep001/scn001/clip00${index + 1}.mp4`,
      expectedDuration: null,
      totalDuration: 8,
      startOffset: index * 8,
      endOffset: index * 8 + 8,
      shotCount: 1,
      displayText: `片段 ${index + 1}`,
      shots: [],
    }));

    const html = renderToStaticMarkup(
      React.createElement(SegmentTimeline, {
        projectName: "demo",
        clips,
        currentClipKey: "scn_001::clip_001",
        availablePaths: new Set(),
        episodeTime: 0,
        totalDuration: 16,
        onSelectClip: () => undefined,
        onPlayAll: () => undefined,
        onInsertClipAfter: () => undefined,
      }),
    );

    expect(html).toContain("在片段 1 后插入镜头");
    expect(html).toContain("w-7");
    expect(html).toContain("h-full");
    expect(html).toContain(">+<");
  });
});
