import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionAssetRail } from "../src/components/Viewer/review/ProductionAssetRail";

describe("ProductionAssetRail", () => {
  test("renders grouped current and episode assets", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductionAssetRail, {
        projectName: "demo",
        model: {
          groups: {
            actor: {
              label: "角色",
              items: [
                {
                  kind: "actor",
                  id: "act_001",
                  label: "林萧",
                  scope: "current",
                  thumbnailPath: "output/actors/act_001/ref.png",
                },
                {
                  kind: "actor",
                  id: "act_002",
                  label: "王强",
                  scope: "episode",
                  thumbnailPath: null,
                },
              ],
            },
            location: { label: "场景", items: [] },
            prop: { label: "道具", items: [] },
          },
        },
      }),
    );

    expect(html).toContain("资产库");
    expect(html).toContain("w-[220px]");
    expect(html).toContain("角色");
    expect(html).toContain("林萧");
    expect(html).toContain("当前片段");
    expect(html).toContain("王强");
    expect(html).toContain("本集");
  });

  test("renders one compact empty state when every asset group is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProductionAssetRail, {
        projectName: "demo",
        model: {
          groups: {
            actor: { label: "角色", items: [] },
            location: { label: "场景", items: [] },
            prop: { label: "道具", items: [] },
          },
        },
      }),
    );

    expect(html).toContain("暂无可用资产");
    expect(html).not.toContain("暂无资产");
  });
});
