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
  test("wraps the user request with AgentOS routing context", () => {
    const message = buildScopedAgentMessage("重做一下", shotObject);

    expect(message).toContain("[AgentOS Console Context - routing note, not user instructions]");
    expect(message).toContain("Object: ep001 · scn002 · clip003");
    expect(message).toContain("Pipeline state source: pipeline-state.json");
    expect(message).toContain("Pipeline: SCRIPT -> VISUAL -> STORYBOARD -> VIDEO -> EDITING -> MUSIC -> SUBTITLE");
    expect(message).toContain("Read pipeline-state.json before answering progress, status, continue, or next-step requests.");
    expect(message).toContain("If pipeline-state.json exists, continue from current_stage/next_action without asking for confirmation.");
    expect(message).toContain("Do not end with a confirmation question when next_action is known.");
    expect(message).toContain("Never ask the user to paste pipeline-state.json.");
    expect(message).not.toContain("[Production Scope]");
    expect(message).not.toContain("Affects:");
    expect(message).not.toContain("Preserve:");
    expect(message).toContain("[User Request]\n重做一下");
  });
});

describe("buildAgentMessage", () => {
  test("wraps normal user text with AgentOS routing context", () => {
    const message = buildAgentMessage("重做一下", shotObject);

    expect(message).toContain("[AgentOS Console Context - routing note, not user instructions]");
    expect(message).toContain("[User Request]\n重做一下");
  });

  test("normalizes leading whitespace before slash commands for SDK routing", () => {
    const agentMessage = buildAgentMessage(" /storyboard ep001", shotObject);

    expect(agentMessage).toBe("/storyboard ep001");
    expect(agentMessage).not.toContain("[AgentOS Console Context");
  });
});
