import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowProgressStrip } from "../src/components/Viewer/views/OverviewView";

describe("OverviewView chrome", () => {
  test("renders current MVP workflow strip without post-production stages", () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkflowProgressStrip, {
        items: [
          { key: "SCRIPT", label: "剧本", state: "current" },
          { key: "VISUAL", label: "素材", state: "idle" },
          { key: "STORYBOARD", label: "分镜", state: "idle" },
          { key: "VIDEO", label: "视频", state: "idle" },
        ],
      }),
    );

    expect(html).not.toContain("输入");
    expect(html).toContain("剧本");
    expect(html).toContain("分镜");
    expect(html).toContain("视频");
    expect(html).not.toContain("剪辑");
  });
});
