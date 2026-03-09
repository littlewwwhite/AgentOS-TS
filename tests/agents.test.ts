import { describe, expect, it } from "vitest";
import { buildAgents } from "../src/agents.js";
import type { AgentConfig, SkillContent } from "../src/loader.js";

describe("buildAgents", () => {
  const mockToolServers = {
    storage: {},
    image: {},
    video: {},
  };

  it("builds agent definitions from AgentConfig + SkillContent", () => {
    const agentConfigs: Record<string, AgentConfig> = {
      "test-agent": {
        name: "test-agent",
        description: "A test agent",
        allowedTools: ["Read", "Write"],
        maxTurns: 15,
        skills: ["test-skill"],
      },
    };

    const skillContents: Record<string, SkillContent> = {
      "test-skill": {
        prompt: "Do testing things.",
        description: "Test skill for unit tests",
        referencesDir: "/skills/test-skill",
      },
    };

    const agents = buildAgents(agentConfigs, skillContents, mockToolServers);

    expect(agents["test-agent"]).toBeDefined();
    expect(agents["test-agent"].description).toBe("A test agent");
    expect(agents["test-agent"].prompt).toContain("Do testing things.");
    expect(agents["test-agent"].tools).toEqual(["Read", "Write"]);
    expect(agents["test-agent"].maxTurns).toBe(15);
  });

  it("uses default maxTurns when not specified", () => {
    const agentConfigs: Record<string, AgentConfig> = {
      "default-agent": {
        name: "default-agent",
        description: "Agent with defaults",
      },
    };

    const agents = buildAgents(agentConfigs, {}, mockToolServers);
    expect(agents["default-agent"].maxTurns).toBe(30);
  });

  it("infers mcpServers from allowed-tools patterns", () => {
    const agentConfigs: Record<string, AgentConfig> = {
      "media-agent": {
        name: "media-agent",
        description: "Media agent",
        allowedTools: ["mcp__image__generate_image", "mcp__video__generate_video"],
      },
    };

    const agents = buildAgents(agentConfigs, {}, mockToolServers);
    expect(agents["media-agent"].mcpServers).toEqual(
      expect.arrayContaining(["image", "video"]),
    );
  });

  it("injects workspace path into agent prompt", () => {
    const agentConfigs: Record<string, AgentConfig> = {
      "ws-agent": {
        name: "ws-agent",
        description: "Workspace agent",
      },
    };

    const agents = buildAgents(agentConfigs, {}, mockToolServers, "/project/workspace");
    expect(agents["ws-agent"].prompt).toContain("/project/workspace/");
  });
});
