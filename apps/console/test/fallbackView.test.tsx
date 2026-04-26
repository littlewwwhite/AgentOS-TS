import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FallbackView } from "../src/components/Viewer/views/FallbackView";

describe("FallbackView", () => {
  test("uses production workbench language instead of file viewer chrome", () => {
    const html = renderToStaticMarkup(
      React.createElement(FallbackView, {
        projectName: "demo-project",
        path: "",
      }),
    );

    expect(html).toContain("从制作总览开始。");
    expect(html).toContain("左侧按短剧制作对象组织入口");
    expect(html).toContain("默认入口");
    expect(html).toContain("制作总览");
    expect(html).not.toContain("标签页会自动固定");
    expect(html).not.toContain("路径");
    expect(html).not.toContain("(根目录)");
  });
});
