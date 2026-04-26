import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectHeader } from "../src/components/Viewer/ObjectHeader";


describe("ObjectHeader", () => {
  test("renders object identity before raw path", () => {
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
    expect(html).toContain("默认作用域");
    expect(html).toContain("current shot");
    expect(html).toContain("不会影响");
    expect(html).toContain("script");
    expect(html).toContain("output/ep001/scn002/clip003/v1.mp4");
  });
});
