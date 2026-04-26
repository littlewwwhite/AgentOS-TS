import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TabBarView } from "../src/components/Viewer/TabBar";
import type { Tab } from "../src/types";

function noop() {}

describe("TabBar", () => {
  test("hides file-editor tab chrome for a single workbench object", () => {
    const html = renderToStaticMarkup(
      React.createElement(TabBarView, {
        tabs: [{ id: "overview", path: "", title: "总览", view: "overview", pinned: true }],
        activeId: "overview",
        activate: noop,
        closeTab: noop,
      }),
    );

    expect(html).toBe("");
  });

  test("renders reference objects only when multiple tabs are open", () => {
    const tabs: Tab[] = [
      { id: "overview", path: "", title: "总览", view: "overview", pinned: true },
      { id: "shot", path: "output/ep001/scn002/clip003/v1.mp4", title: "ep001 · scn002 · clip003", view: "video", pinned: true },
    ];
    const html = renderToStaticMarkup(
      React.createElement(TabBarView, {
        tabs,
        activeId: "shot",
        activate: noop,
        closeTab: noop,
      }),
    );

    expect(html).toContain("参考对象");
    expect(html).toContain("总览");
    expect(html).toContain("ep001 · scn002 · clip003");
  });
});
