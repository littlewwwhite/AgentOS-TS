import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectHeader } from "../src/components/Viewer/ObjectHeader";
import { shouldShowObjectHeader } from "../src/components/Viewer/Viewer";


describe("ObjectHeader", () => {
  test("keeps the workbench header to the active object title", () => {
    const html = renderToStaticMarkup(
      React.createElement(ObjectHeader, {
        object: {
          type: "shot",
          episodeId: "ep001",
          sceneId: "scn002",
          shotId: "clip003",
          path: "output/ep001/scn002/clip003/v1.mp4",
        },
        viewKind: "video",
      }),
    );

    expect(html).toContain("ep001 · scn002 · clip003");
    expect(html).not.toContain("镜头");
    expect(html).not.toContain("默认只改当前镜头");
    expect(html).not.toContain("不改剧本、分镜定稿和登记素材");
    expect(html).not.toContain("current shot");
    expect(html).not.toContain("script");
    expect(html).not.toContain("output/ep001/scn002/clip003/v1.mp4");
  });

  test("does not show generic artifact chrome for fallback documents", () => {
    const html = renderToStaticMarkup(
      React.createElement(ObjectHeader, {
        object: {
          type: "artifact",
          path: "draft/episodes/ep007.md",
        },
        viewKind: "text",
      }),
    );

    expect(html).toContain("当前产物");
    expect(html).not.toContain("ep007.md");
    expect(html).not.toContain("·");
    expect(html).not.toContain("文档");
    expect(html).not.toContain("默认只处理当前打开的产物");
    expect(html).not.toContain("不扩散到其他产物");
  });

  test("hides the outer object header for views with their own production chrome", () => {
    expect(shouldShowObjectHeader("text", "draft/episodes/ep019.md")).toBe(false);
    expect(shouldShowObjectHeader("json", "output/script.json")).toBe(false);
    expect(shouldShowObjectHeader("storyboard", "output/storyboard/approved/ep001_storyboard.json")).toBe(false);
    expect(shouldShowObjectHeader("overview", "")).toBe(true);
    expect(shouldShowObjectHeader("video", "output/ep001/scn001/clip001.mp4")).toBe(true);
  });
});
