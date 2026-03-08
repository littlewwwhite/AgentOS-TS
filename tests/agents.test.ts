import { describe, expect, it } from "vitest";
import { buildAgents, filePolicy } from "../src/agents.js";
import type { SkillFrontmatter } from "../src/agents.js";

describe("buildAgents", () => {
  const mockToolServers = {
    storage: {},
    image: {},
    video: {},
  };

  it("builds agent definitions from skill frontmatter", () => {
    const skills: Record<string, SkillFrontmatter & { prompt: string }> = {
      "test-agent": {
        name: "test-agent",
        description: "A test agent",
        prompt: "Do testing things.",
        allowedTools: ["Read", "Write"],
        maxTurns: 15,
      },
    };

    const agents = buildAgents(skills, mockToolServers);

    expect(agents["test-agent"]).toBeDefined();
    expect(agents["test-agent"].description).toBe("A test agent");
    expect(agents["test-agent"].prompt).toBe("Do testing things.");
    expect(agents["test-agent"].tools).toEqual(["Read", "Write"]);
    expect(agents["test-agent"].maxTurns).toBe(15);
  });

  it("uses default maxTurns when not specified", () => {
    const skills: Record<string, SkillFrontmatter & { prompt: string }> = {
      "default-agent": {
        name: "default-agent",
        description: "Agent with defaults",
        prompt: "Prompt.",
      },
    };

    const agents = buildAgents(skills, mockToolServers);
    expect(agents["default-agent"].maxTurns).toBe(30);
  });

  it("maps mcpServers from tool server registry", () => {
    const skills: Record<string, SkillFrontmatter & { prompt: string }> = {
      "media-agent": {
        name: "media-agent",
        description: "Media agent",
        prompt: "Generate media.",
        mcpServers: ["image", "video"],
      },
    };

    const agents = buildAgents(skills, mockToolServers);
    expect(agents["media-agent"].mcpServers).toEqual({
      image: {},
      video: {},
    });
  });
});

describe("filePolicy", () => {
  it("has policy for all expected agents", () => {
    const expected = [
      "script-writer",
      "script-adapt",
      "image-create",
      "image-edit",
      "video-create",
      "video-review",
      "music-finder",
      "music-matcher",
    ];
    for (const name of expected) {
      expect(filePolicy[name]).toBeDefined();
      expect(filePolicy[name].readable.length).toBeGreaterThan(0);
      expect(filePolicy[name].writable.length).toBeGreaterThan(0);
    }
  });

  it("all policies have both readable and writable arrays", () => {
    for (const [name, policy] of Object.entries(filePolicy)) {
      expect(Array.isArray(policy.readable), `${name}.readable`).toBe(true);
      expect(Array.isArray(policy.writable), `${name}.writable`).toBe(true);
    }
  });
});
