// input: Agents directory structure after skill consolidation
// output: Verifies skill consolidation invariants
// pos: Integration test — validates 4-agent / 7-skill architecture

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const AGENTS_DIR = path.resolve("agents");

// Expected 4 domain agents + skill-creator
const EXPECTED_AGENTS = [
  "art-director",
  "footage-producer",
  "post-processor",
  "screenwriter",
  "skill-creator",
];

// Expected skill allocation after consolidation
const EXPECTED_SKILLS: Record<string, string[]> = {
  "art-director": ["asset-gen"],
  "footage-producer": ["storyboard-generate", "video-create"],
  "post-processor": ["music-matcher", "subtitle-maker", "video-editing"],
  "screenwriter": ["script-adapt", "script-writer"],
};

// Skills that MUST NOT exist (deleted in consolidation)
const DELETED_SKILLS = ["create-subject", "kling-video-prompt"];

// Old agents that MUST NOT have .claude/ directories
const DELETED_AGENTS = ["video-editor", "post-production"];

describe("skill consolidation: agent structure", () => {
  it("has exactly the expected agent manifests", async () => {
    const entries = await fs.readdir(AGENTS_DIR);
    const yamls = entries
      .filter((e) => e.endsWith(".yaml"))
      .map((e) => e.replace(".yaml", ""))
      .sort();
    expect(yamls).toEqual(EXPECTED_AGENTS);
  });

  it("each domain agent has matching .claude/ directory", async () => {
    const domainAgents = EXPECTED_AGENTS.filter((a) => a !== "skill-creator");
    for (const agent of domainAgents) {
      const claudeDir = path.join(AGENTS_DIR, agent, ".claude");
      const stat = await fs.stat(claudeDir);
      expect(stat.isDirectory(), `${agent}/.claude should exist`).toBe(true);
    }
  });

  it("deleted agents have no .claude/ directories", async () => {
    for (const agent of DELETED_AGENTS) {
      const claudeDir = path.join(AGENTS_DIR, agent, ".claude");
      const exists = await fs.access(claudeDir).then(() => true).catch(() => false);
      expect(exists, `${agent}/.claude should NOT exist`).toBe(false);
    }
  });
});

describe("skill consolidation: skill allocation", () => {
  for (const [agent, skills] of Object.entries(EXPECTED_SKILLS)) {
    it(`${agent} has exactly [${skills.join(", ")}]`, async () => {
      const skillsDir = path.join(AGENTS_DIR, agent, ".claude", "skills");
      const entries = await fs.readdir(skillsDir);
      const dirs = (
        await Promise.all(
          entries.map(async (e) => {
            const stat = await fs.stat(path.join(skillsDir, e));
            return stat.isDirectory() ? e : null;
          }),
        )
      ).filter(Boolean) as string[];
      expect(dirs.sort()).toEqual(skills.sort());
    });
  }

  it("no deleted skills exist anywhere", async () => {
    for (const agent of Object.keys(EXPECTED_SKILLS)) {
      const skillsDir = path.join(AGENTS_DIR, agent, ".claude", "skills");
      const entries = await fs.readdir(skillsDir);
      for (const deleted of DELETED_SKILLS) {
        expect(entries, `${agent} should not have ${deleted}`).not.toContain(deleted);
      }
    }
  });
});

describe("skill consolidation: SKILL.md validity", () => {
  for (const [agent, skills] of Object.entries(EXPECTED_SKILLS)) {
    for (const skill of skills) {
      it(`${agent}/${skill}/SKILL.md has valid frontmatter`, async () => {
        const skillPath = path.join(AGENTS_DIR, agent, ".claude", "skills", skill, "SKILL.md");
        const content = await fs.readFile(skillPath, "utf-8");

        // Must start with ---
        expect(content.startsWith("---"), `${skill} SKILL.md must start with ---`).toBe(true);

        // Must have closing ---
        const secondDelim = content.indexOf("---", 3);
        expect(secondDelim, `${skill} SKILL.md must have closing ---`).toBeGreaterThan(3);

        // Extract frontmatter
        const frontmatter = content.slice(3, secondDelim);

        // Must have name field
        expect(frontmatter).toMatch(/^name:\s+\S+/m);

        // Must have description field
        expect(frontmatter).toMatch(/^description:/m);

        // Name must match folder
        const nameMatch = frontmatter.match(/^name:\s+(.+)$/m);
        expect(nameMatch?.[1]?.trim()).toBe(skill);
      });
    }
  }
});

describe("skill consolidation: shared code", () => {
  it("_shared/scripts/detect_source_structure.py exists", async () => {
    const scriptPath = path.join(AGENTS_DIR, "_shared", "scripts", "detect_source_structure.py");
    const stat = await fs.stat(scriptPath);
    expect(stat.isFile()).toBe(true);
  });

  it("_shared/scripts/subject_api.py exists", async () => {
    const scriptPath = path.join(AGENTS_DIR, "_shared", "scripts", "subject_api.py");
    const stat = await fs.stat(scriptPath);
    expect(stat.isFile()).toBe(true);
  });

  it("no duplicate detect_source_structure.py in skill dirs", async () => {
    const locations = [
      "screenwriter/.claude/skills/script-adapt/scripts/detect_source_structure.py",
      "screenwriter/.claude/skills/script-writer/scripts/detect_source_structure.py",
    ];
    for (const loc of locations) {
      const exists = await fs.access(path.join(AGENTS_DIR, loc)).then(() => true).catch(() => false);
      expect(exists, `${loc} should NOT exist (moved to _shared)`).toBe(false);
    }
  });
});

describe("skill consolidation: no orphaned references", () => {
  it("session-specs.ts does not reference deleted agents", async () => {
    const content = await fs.readFile(
      path.resolve("src", "session-specs.ts"),
      "utf-8",
    );
    expect(content).not.toContain("video-editor");
    expect(content).not.toContain("post-production");
  });

  it("agent yamls do not reference deleted skills", async () => {
    for (const agent of EXPECTED_AGENTS) {
      const yamlPath = path.join(AGENTS_DIR, `${agent}.yaml`);
      const content = await fs.readFile(yamlPath, "utf-8");
      for (const deleted of DELETED_SKILLS) {
        expect(content, `${agent}.yaml should not reference ${deleted}`).not.toContain(deleted);
      }
    }
  });
});
