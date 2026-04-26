import { describe, expect, test } from "bun:test";
import { buildScopedAgentMessage } from "../src/lib/scopedMessage";


describe("buildScopedAgentMessage", () => {
  test("wraps the user request with explicit production scope", () => {
    const message = buildScopedAgentMessage("重做一下", {
      type: "shot",
      episodeId: "ep001",
      sceneId: "scn002",
      shotId: "clip003",
      path: "output/ep001/scn002/clip003/v1.mp4",
    });

    expect(message).toContain("[Production Scope]");
    expect(message).toContain("Object: ep001 · scn002 · clip003");
    expect(message).toContain("Default scope: current shot");
    expect(message).toContain("Affects: shot video candidate");
    expect(message).toContain("Preserve: script / storyboard / registered assets");
    expect(message).toContain("[User Request]\n重做一下");
  });
});
