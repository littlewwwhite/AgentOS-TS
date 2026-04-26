import { describe, expect, test } from "bun:test";
import { buildAgentMessage, buildScopedAgentMessage } from "../src/lib/scopedMessage";


const shotObject = {
  type: "shot" as const,
  episodeId: "ep001",
  sceneId: "scn002",
  shotId: "clip003",
  path: "output/ep001/scn002/clip003/v1.mp4",
};

describe("buildScopedAgentMessage", () => {
  test("wraps the user request with explicit production scope", () => {
    const message = buildScopedAgentMessage("重做一下", shotObject);

    expect(message).toContain("[Production Scope]");
    expect(message).toContain("Object: ep001 · scn002 · clip003");
    expect(message).toContain("Default scope: current shot");
    expect(message).toContain("Affects: shot video candidate");
    expect(message).toContain("Preserve: script / storyboard / registered assets");
    expect(message).toContain("[User Request]\n重做一下");
  });
});

describe("buildAgentMessage", () => {
  test("wraps normal user text with production scope", () => {
    const message = buildAgentMessage("重做一下", shotObject);

    expect(message).toContain("[Production Scope]");
    expect(message).toContain("[User Request]\n重做一下");
  });

  test("normalizes leading whitespace before slash commands for SDK routing", () => {
    const agentMessage = buildAgentMessage(" /storyboard ep001", shotObject);

    expect(agentMessage).toBe("/storyboard ep001");
    expect(agentMessage).not.toContain("[Production Scope]");
  });
});
