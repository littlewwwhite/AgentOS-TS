import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StageStatus } from "../src/types";
import { StoryboardNode } from "../src/components/Navigator/StoryboardNode";

describe("StoryboardNode", () => {
  test("shows approved storyboard artifacts as a production navigation entry", () => {
    const html = renderToStaticMarkup(
      React.createElement(StoryboardNode, {
        status: "completed" as StageStatus,
        paths: ["output/storyboard/approved/ep001_storyboard.json"],
        unread: new Map<string, number>(),
        openPath: () => undefined,
      }),
    );

    expect(html).toContain("故事板");
    expect(html).toContain("ep001");
    expect(html).toContain("完成");
    expect(html).not.toContain("分镜草稿");
  });

  test("normalizes storyboard episode names with underscores", () => {
    const html = renderToStaticMarkup(
      React.createElement(StoryboardNode, {
        paths: ["output/storyboard/approved/EP_001_storyboard.json"],
        unread: new Map<string, number>(),
        openPath: () => undefined,
      }),
    );

    expect(html).toContain("ep001");
    expect(html).not.toContain("EP_001");
  });

  test("shows one storyboard entry per episode and prefers the approved artifact", () => {
    let openedPath = "";
    const html = renderToStaticMarkup(
      React.createElement(StoryboardNode, {
        paths: [
          "output/storyboard/draft/ep001_storyboard.json",
          "output/storyboard/approved/ep001_storyboard.json",
        ],
        unread: new Map<string, number>(),
        openPath: (path: string) => { openedPath = path; },
      }),
    );

    expect(html.match(/ep001/g)?.length).toBe(1);

    const element = StoryboardNode({
      paths: [
        "output/storyboard/draft/ep001_storyboard.json",
        "output/storyboard/approved/ep001_storyboard.json",
      ],
      unread: new Map<string, number>(),
      openPath: (path: string) => { openedPath = path; },
    });
    const child = (element.props.children as any[])[0];
    child.props.onClick();

    expect(openedPath).toBe("output/storyboard/approved/ep001_storyboard.json");
  });

  test("storyboard navigation opens storyboard json instead of episode video folders", () => {
    const opened: Array<{ path: string; title: string }> = [];
    const element = StoryboardNode({
      status: "completed" as StageStatus,
      paths: [
        "output/storyboard/approved/ep001_storyboard.json",
        "output/ep001/ep001_delivery.json",
        "output/ep001/scn001/ep001_scn001_clip001.mp4",
      ],
      unread: new Map<string, number>(),
      openPath: (path: string, _view: any, title: string) => opened.push({ path, title }),
    });

    // only storyboard artifact paths should produce navigation entries (delivery/video filtered out)
    const children = element.props.children as any[];
    expect(children).toHaveLength(1);

    // clicking the single entry should open the storyboard json
    children[0].props.onClick();

    expect(opened).toEqual([
      {
        path: "output/storyboard/approved/ep001_storyboard.json",
        title: "ep001/故事板",
      },
    ]);
  });
});
