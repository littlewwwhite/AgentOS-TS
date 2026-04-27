import { describe, expect, test } from "bun:test";
import { buildNavigatorSections } from "../src/lib/navigatorSections";

describe("buildNavigatorSections", () => {
  test("keeps a stable production navigation skeleton", () => {
    const sections = buildNavigatorSections({
      hasSource: false,
      hasCatalog: false,
      hasScript: false,
      hasAssets: false,
      hasStoryboard: false,
      episodeIds: [],
    });

    expect(sections.map((section) => section.key)).toEqual([
      "overview",
      "inputs",
      "catalog",
      "script",
      "assets",
      "storyboard",
      "episodes",
    ]);
    expect(sections.map((section) => section.available)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(sections.map((section) => section.label)).toContain("视觉设定");
    expect(sections.map((section) => section.label)).not.toContain("设定目录");
  });

  test("marks completed top-level areas as available without changing order", () => {
    const sections = buildNavigatorSections({
      hasSource: true,
      hasCatalog: true,
      hasScript: true,
      hasAssets: true,
      hasStoryboard: true,
      episodeIds: ["ep001"],
    });

    expect(sections.map((section) => section.key)).toEqual([
      "overview",
      "inputs",
      "catalog",
      "script",
      "assets",
      "storyboard",
      "episodes",
    ]);
    expect(sections.every((section) => section.available)).toBe(true);
  });

  test("hides editing, music, subtitle nodes in current MVP", () => {
    const sections = buildNavigatorSections({
      hasSource: true,
      hasCatalog: false,
      hasScript: true,
      hasAssets: false,
      hasStoryboard: false,
      episodeIds: ["ep001"],
    });

    expect(JSON.stringify(sections)).not.toContain("剪辑");
    expect(JSON.stringify(sections)).not.toContain("配乐");
    expect(JSON.stringify(sections)).not.toContain("字幕");
  });

  test("tags each section with cross_episode or per_episode group", () => {
    const sections = buildNavigatorSections({
      hasSource: true,
      hasCatalog: true,
      hasScript: true,
      hasAssets: true,
      hasStoryboard: true,
      episodeIds: ["ep001"],
    });

    const groups = Object.fromEntries(
      sections.map((section) => [section.key, section.group]),
    );
    expect(groups).toEqual({
      overview: "cross_episode",
      inputs: "cross_episode",
      catalog: "cross_episode",
      script: "cross_episode",
      assets: "cross_episode",
      storyboard: "per_episode",
      episodes: "per_episode",
    });
  });
});
