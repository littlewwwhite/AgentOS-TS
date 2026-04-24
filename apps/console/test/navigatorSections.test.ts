import { describe, expect, test } from "bun:test";
import { buildNavigatorSections } from "../src/lib/navigatorSections";

describe("buildNavigatorSections", () => {
  test("orders navigation as overview, inputs, script, assets, episodes for current MVP", () => {
    const sections = buildNavigatorSections({
      hasSource: true,
      hasCatalog: true,
      hasScript: true,
      hasAssets: true,
      episodeIds: ["ep001"],
    });

    expect(sections.map((section) => section.key)).toEqual([
      "overview",
      "inputs",
      "catalog",
      "script",
      "assets",
      "episodes",
    ]);
  });

  test("hides editing, music, subtitle nodes in current MVP", () => {
    const sections = buildNavigatorSections({
      hasSource: true,
      hasCatalog: false,
      hasScript: true,
      hasAssets: false,
      episodeIds: ["ep001"],
    });

    expect(JSON.stringify(sections)).not.toContain("剪辑");
    expect(JSON.stringify(sections)).not.toContain("配乐");
    expect(JSON.stringify(sections)).not.toContain("字幕");
  });
});
