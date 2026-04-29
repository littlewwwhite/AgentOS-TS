import { describe, expect, test } from "bun:test";
import {
  buildNavigatorSections,
  shouldShowGroupDivider,
} from "../src/lib/navigatorSections";
import type { NavigatorSection } from "../src/lib/navigatorSections";

describe("buildNavigatorSections", () => {
  test("keeps a stable production navigation skeleton", () => {
    const sections = buildNavigatorSections({
      hasSource: false,
      hasCatalog: false,
      hasScript: false,
      hasAssets: false,
      episodeIds: [],
    });

    expect(sections.map((section) => section.key)).toEqual([
      "overview",
      "inputs",
      "script",
      "assets",
      "episodes",
    ]);
    expect(sections.map((section) => section.available)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(sections.map((section) => section.label)).not.toContain("视觉设定");
    expect(sections.map((section) => section.label)).toContain("素材");
    expect(sections.map((section) => section.label)).not.toContain("设定目录");
  });

  test("marks completed top-level areas as available without changing order", () => {
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
      "script",
      "assets",
      "episodes",
    ]);
    expect(sections.every((section) => section.available)).toBe(true);
  });

  test("makes assets available when only visual catalog exists", () => {
    const sections = buildNavigatorSections({
      hasSource: false,
      hasCatalog: true,
      hasScript: false,
      hasAssets: false,
      episodeIds: [],
    });

    expect(sections.find((section) => section.key === "assets")?.available).toBe(true);
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

  test("tags each section with cross_episode or per_episode group", () => {
    const sections = buildNavigatorSections({
      hasSource: true,
      hasCatalog: true,
      hasScript: true,
      hasAssets: true,
      episodeIds: ["ep001"],
    });

    const groups = Object.fromEntries(
      sections.map((section) => [section.key, section.group]),
    );
    expect(groups).toEqual({
      overview: "cross_episode",
      inputs: "cross_episode",
      script: "cross_episode",
      assets: "cross_episode",
      episodes: "per_episode",
    });
  });
});

describe("shouldShowGroupDivider", () => {
  const episodesAvailable: NavigatorSection = {
    key: "episodes",
    label: "分集视频",
    available: true,
    group: "per_episode",
  };
  const episodesEmpty: NavigatorSection = {
    ...episodesAvailable,
    available: false,
  };
  const crossSection: NavigatorSection = {
    key: "assets",
    label: "素材",
    available: true,
    group: "cross_episode",
  };

  test("shows divider at the cross_episode → per_episode boundary when target is available", () => {
    expect(shouldShowGroupDivider("cross_episode", episodesAvailable)).toBe(true);
  });

  test("hides divider when the per_episode section has no episodes yet", () => {
    expect(shouldShowGroupDivider("cross_episode", episodesEmpty)).toBe(false);
  });

  test("hides divider between two cross_episode sections", () => {
    expect(shouldShowGroupDivider("cross_episode", crossSection)).toBe(false);
  });

  test("hides divider for the very first section (no previous group)", () => {
    expect(shouldShowGroupDivider(null, episodesAvailable)).toBe(false);
  });
});
