import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../src/contexts/TabsContext", () => ({
  useTabs: () => ({
    openPath: () => undefined,
  }),
}));

const { EpisodeNode } = await import("../src/components/Navigator/EpisodeNode");

describe("EpisodeNode", () => {
  test("renders one episode workbench entry instead of separate storyboard and video tabs", () => {
    const html = renderToStaticMarkup(
      React.createElement(EpisodeNode, {
        epId: "ep001",
        ep: {
          storyboard: { status: "completed", artifact: "output/storyboard/approved/ep001_storyboard.json" },
          video: { status: "completed", artifact: "output/ep001" },
        },
        unread: new Map(),
      }),
    );

    expect(html).toContain("打开 ep001");
    expect(html).toContain("ep001");
    expect(html).not.toContain("分镜");
    expect(html).not.toContain("视频");
  });
});
