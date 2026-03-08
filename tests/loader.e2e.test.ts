// E2E validation: load real skills/ directory
import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { loadSkills } from "../src/loader.js";
import { buildAgents } from "../src/agents.js";

const SKILLS_DIR = path.resolve("skills");
const hasSkills = await fs.access(SKILLS_DIR).then(() => true).catch(() => false);

describe.skipIf(!hasSkills)("loader E2E", () => {
  it("loads all skills from real skills/ directory", async () => {
    const skills = await loadSkills(SKILLS_DIR);
    const names = Object.keys(skills);

    expect(names.length).toBeGreaterThan(0);
    console.log(`  Loaded ${names.length} skills: ${names.join(", ")}`);

    for (const [name, skill] of Object.entries(skills)) {
      expect(skill.name).toBe(name);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.prompt.length).toBeGreaterThan(0);
    }
  });

  it("can build agent definitions from loaded skills", async () => {
    const skills = await loadSkills(SKILLS_DIR);
    const agents = buildAgents(skills, {
      storage: {},
      image: {},
      video: {},
      audio: {},
      script: {},
    });

    expect(Object.keys(agents).length).toBe(Object.keys(skills).length);

    for (const [name, agent] of Object.entries(agents)) {
      expect(agent.description.length).toBeGreaterThan(0);
      expect(agent.prompt.length).toBeGreaterThan(0);
      expect(agent.maxTurns).toBeGreaterThan(0);
    }
  });
});
