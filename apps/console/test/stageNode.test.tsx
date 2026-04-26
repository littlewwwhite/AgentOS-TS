import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StageNode } from "../src/components/Navigator/StageNode";

describe("StageNode", () => {
  test("uses explicit pending copy for disabled production areas", () => {
    const html = renderToStaticMarkup(
      React.createElement(StageNode, {
        label: "视觉设定",
        disabled: true,
        pendingLabel: "待生成角色、场景、道具",
      }),
    );

    expect(html).toContain("视觉设定");
    expect(html).toContain("待生成角色、场景、道具");
    expect(html).not.toContain("未开始");
    expect(html).not.toContain("设定目录");
  });

  test("keeps real pipeline status visible for disabled areas", () => {
    const html = renderToStaticMarkup(
      React.createElement(StageNode, {
        label: "素材",
        status: "running",
        disabled: true,
      }),
    );

    expect(html).toContain("素材");
    expect(html).toContain("运行");
    expect(html).not.toContain("未开始");
  });
});
