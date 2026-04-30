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
        selectedAssetId: "act_001",
        onSelectAsset: () => undefined,
      }),
    );

    expect(html).toContain("资产库");
    expect(html).toContain("选择已有资产");
    expect(html).not.toContain("添加角色");
    expect(html).not.toContain("添加场景");
    expect(html).not.toContain("添加道具");
    expect(html).not.toContain("生成场景多视图拼接图");
    expect(html).not.toContain("生成道具多角度细节拼接图");
    expect(html).toContain("w-[220px]");
    expect(html).toContain("角色");
    expect(html).toContain("林萧");
    expect(html).toContain("选择 林萧");
    expect(html).toContain("aria-pressed=\"true\"");
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

  test("limits replacement mode to assets of the selected reference kind", () => {
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
                  thumbnailPath: null,
                },
              ],
            },
            location: {
              label: "场景",
              items: [
                {
                  kind: "location",
                  id: "loc_001",
                  label: "寝殿",
                  scope: "current",
                  thumbnailPath: null,
                },
              ],
            },
            prop: { label: "道具", items: [] },
          },
        },
        selectedAssetId: "act_001",
        replacementKind: "actor",
        replacementLabel: "林萧（女仆装）",
        onSelectAsset: () => undefined,
      }),
    );

    expect(html).toContain("替换 林萧（女仆装）");
    expect(html).toContain("选择替换");
    expect(html).toContain("用 林萧 替换 林萧（女仆装）");
    expect(html).toContain("aria-disabled=\"true\"");
    expect(html).not.toContain("用 寝殿 替换 林萧（女仆装）");
  });
});
