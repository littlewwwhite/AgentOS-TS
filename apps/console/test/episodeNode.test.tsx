import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EpisodeNode } from "../src/components/Navigator/EpisodeNode";
import { TabsProvider } from "../src/contexts/TabsContext";
import type { EpisodeState } from "../src/types";

function render(ui: React.ReactElement) {
  return renderToStaticMarkup(React.createElement(TabsProvider, null, ui));
}

describe("EpisodeNode", () => {
  test("renders sub-stage rows when defaultOpen is true", () => {
    const ep: EpisodeState = {
      storyboard: { status: "completed", artifact: "output/storyboard/approved/ep001_storyboard.json" },
      video: { status: "running" },
    };

    const html = render(
      React.createElement(EpisodeNode, {
        epId: "ep001",
        ep,
        unread: new Map<string, number>(),
        defaultOpen: true,
      }),
    );

    expect(html).toContain("ep001");
    expect(html).toContain("故事板");
    expect(html).toContain("视频");
    expect(html).not.toContain("分镜");
  });

  test("collapsed by default does not render sub-stage labels", () => {
    const html = render(
      React.createElement(EpisodeNode, {
        epId: "ep002",
        ep: undefined,
        unread: new Map<string, number>(),
      }),
    );
    expect(html).toContain("ep002");
    expect(html).not.toContain("故事板");
    expect(html).not.toContain("视频");
  });
});
