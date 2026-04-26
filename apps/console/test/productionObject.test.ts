import { describe, expect, test } from "bun:test";
import {
  getProductionObjectAvailableActions,
  getProductionObjectLabel,
  getProductionObjectLineage,
  getProductionObjectScope,
  resolveProductionObjectFromPath,
} from "../src/lib/productionObject";

describe("productionObject", () => {
  test("empty path resolves to project object", () => {
    const object = resolveProductionObjectFromPath("", { projectId: "demo" });
    expect(object).toEqual({ type: "project", projectId: "demo" });
    expect(getProductionObjectLabel(object)).toBe("demo");
    expect(getProductionObjectScope(object).defaultScope).toBe("entire project");
  });

  test("script path resolves to script object", () => {
    const object = resolveProductionObjectFromPath("output/script.json", { projectId: "demo" });
    expect(object).toEqual({ type: "script", path: "output/script.json" });
    expect(getProductionObjectLabel(object)).toBe("Script");
    expect(getProductionObjectLineage(object)).toEqual(["source", "script"]);
    expect(getProductionObjectAvailableActions(object)).toContain("request script revision");
  });

  test("approved storyboard path resolves to episode object", () => {
    const object = resolveProductionObjectFromPath("output/storyboard/approved/ep001_storyboard.json");
    expect(object).toEqual({
      type: "episode",
      episodeId: "ep001",
      artifactRole: "storyboard",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
    expect(getProductionObjectLabel(object)).toBe("ep001 · Storyboard");
    expect(getProductionObjectScope(object).affects).toEqual(["storyboard", "downstream video"]);
  });

  test("storyboard path supports underscored and case variant episode ids", () => {
    const object = resolveProductionObjectFromPath("output/storyboard/approved/EP_001_storyboard.json");
    expect(object).toEqual({
      type: "episode",
      episodeId: "ep001",
      artifactRole: "storyboard",
      path: "output/storyboard/approved/EP_001_storyboard.json",
    });
    expect(getProductionObjectLabel(object)).toBe("ep001 · Storyboard");
  });

  test("shot video path resolves to shot object", () => {
    const object = resolveProductionObjectFromPath("output/ep001/scn002/clip003/v1.mp4");
    expect(object).toEqual({
      type: "shot",
      episodeId: "ep001",
      sceneId: "scn002",
      shotId: "clip003",
      path: "output/ep001/scn002/clip003/v1.mp4",
    });
    expect(getProductionObjectLabel(object)).toBe("ep001 · scn002 · clip003");
    expect(getProductionObjectScope(object)).toMatchObject({
      defaultScope: "current shot",
      preserves: ["script", "storyboard", "registered assets"],
    });
  });

  test("filename-style shot video path resolves to shot object", () => {
    const object = resolveProductionObjectFromPath("output/ep001/scn002/ep001_scn002_clip001_003.mp4");
    expect(object).toEqual({
      type: "shot",
      episodeId: "ep001",
      sceneId: "scn002",
      shotId: "clip001",
      path: "output/ep001/scn002/ep001_scn002_clip001_003.mp4",
    });
    expect(getProductionObjectLabel(object)).toBe("ep001 · scn002 · clip001");
  });

  test("asset library and asset item paths resolve to asset objects", () => {
    const library = resolveProductionObjectFromPath("output/actors");
    expect(library).toEqual({ type: "asset", assetType: "actor", path: "output/actors" });
    expect(getProductionObjectLabel(library)).toBe("Actors");

    const item = resolveProductionObjectFromPath("output/actors/hero/ref.png");
    expect(item).toEqual({ type: "asset", assetType: "actor", assetId: "hero", path: "output/actors/hero/ref.png" });
    expect(getProductionObjectLabel(item)).toBe("Actor · hero");
    expect(getProductionObjectScope(item).affects).toEqual(["visual identity", "downstream storyboard/video consistency"]);
  });

  test("asset manifest paths resolve to library-level asset objects", () => {
    const actors = resolveProductionObjectFromPath("output/actors/actors.json");
    expect(actors).toEqual({ type: "asset", assetType: "actor", path: "output/actors/actors.json" });
    expect(getProductionObjectLabel(actors)).toBe("Actors");
    expect(getProductionObjectScope(actors).defaultScope).toBe("actor library");

    expect(resolveProductionObjectFromPath("output/locations/locations.json")).toEqual({
      type: "asset",
      assetType: "location",
      path: "output/locations/locations.json",
    });
    expect(resolveProductionObjectFromPath("output/props/props.json")).toEqual({
      type: "asset",
      assetType: "prop",
      path: "output/props/props.json",
    });
  });

  test("unknown path falls back to artifact object", () => {
    const object = resolveProductionObjectFromPath("draft/design.json");
    expect(object).toEqual({ type: "artifact", path: "draft/design.json" });
    expect(getProductionObjectLabel(object)).toBe("design.json");
  });
});
