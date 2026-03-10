import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface AgentSettings {
  permissions?: {
    allow?: string[];
  };
}

const AGENTS_DIR = path.resolve("agents");

async function listAgentNames(): Promise<string[]> {
  const entries = await fs.readdir(AGENTS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("agent filesystem configuration", () => {
  it("does not instruct agents to call an explicit Skill tool", async () => {
    const agentNames = await listAgentNames();

    for (const agentName of agentNames) {
      const claudePath = path.join(AGENTS_DIR, agentName, ".claude", "CLAUDE.md");
      const contents = await fs.readFile(claudePath, "utf-8");

      expect(contents).not.toContain("Use the `Skill` tool");
    }
  });

  it("does not claim .claude/skills is SDK-native auto-loaded", async () => {
    const agentNames = await listAgentNames();

    for (const agentName of agentNames) {
      const claudePath = path.join(AGENTS_DIR, agentName, ".claude", "CLAUDE.md");
      const contents = await fs.readFile(claudePath, "utf-8");

      expect(contents).not.toContain("Skills are auto-loaded from `.claude/skills/`.");
    }
  });

  it("grants Skill permission in agent settings for SDK-native skill discovery", async () => {
    const agentNames = await listAgentNames();

    for (const agentName of agentNames) {
      const settingsPath = path.join(AGENTS_DIR, agentName, ".claude", "settings.json");
      const contents = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(contents) as AgentSettings;

      expect(
        settings.permissions?.allow ?? [],
        `${agentName}/settings.json must include "Skill" for SDK skill discovery`,
      ).toContain("Skill");
    }
  });
});
