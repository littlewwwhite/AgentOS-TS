import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProductionObjectFromPath } from "../src/lib/productionObject";
import { getEditImpactUiLabel, getProductionObjectUiCopy, getProductionObjectUiTitle } from "../src/lib/productionObjectUi";

describe("RawFileEditor chrome", () => {
  test("uses production object language instead of raw file editor chrome", () => {
    const object = resolveProductionObjectFromPath("draft/episodes/ep007.md");
    const title = getProductionObjectUiTitle(object);
    const copy = getProductionObjectUiCopy(object);
    const subtitle = `${copy.objectKind}编辑`;
    const editorLabel = `${title} 编辑区`;

    expect(title).toBe("ep007");
    expect(subtitle).toBe("ep007 分集编辑");
    expect(editorLabel).toBe("ep007 编辑区");
    expect([title, subtitle, editorLabel].join(" ")).not.toContain("ep007.md");
    expect(subtitle).not.toBe("可编辑源文件");
    expect(editorLabel).not.toBe("draft/episodes/ep007.md raw editor");
  });

  test("localizes canonical objects that previously used internal English labels", () => {
    expect(getProductionObjectUiTitle(resolveProductionObjectFromPath("output/script.json"))).toBe("剧本");
    expect(getProductionObjectUiTitle(resolveProductionObjectFromPath("output/storyboard/approved/ep001_storyboard.json"))).toBe("ep001 · 故事板");
    expect(getProductionObjectUiTitle(resolveProductionObjectFromPath("output/actors/hero/ref.png"))).toBe("角色 · hero");
    expect(getProductionObjectUiTitle(resolveProductionObjectFromPath("draft/design.json"))).toBe("当前产物");
  });

  test("uses compact lifecycle warning copy instead of stage invalidation prose", () => {
    const label = getEditImpactUiLabel("output/script.json");

    expect(label).toBe("保存后需重新审核下游制作");
    expect(label).not.toContain("你正在编辑 SCRIPT 阶段业务节点");
    expect(label).not.toContain("STORYBOARD → VIDEO → EDITING → MUSIC → SUBTITLE");
  });

  test("keeps the editable object title and save controls in one toolbar", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/common/RawFileEditor.tsx"),
      "utf-8",
    );

    expect(source).toContain("justify-between");
    expect(source).toContain("{objectLabel}");
    expect(source.indexOf("{objectLabel}")).toBeLessThan(source.indexOf("{helperLabel(state, savedAt, error, dirty)}"));
  });
});
