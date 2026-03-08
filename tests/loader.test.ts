import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadSkills } from "../src/loader.js";

describe("loadSkills", () => {
  it("returns empty for nonexistent directory", async () => {
    const skills = await loadSkills("/nonexistent/path");
    expect(Object.keys(skills)).toHaveLength(0);
  });

  it("parses skill frontmatter and body", async () => {
    // Create a temporary skill directory
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-test-"));
    const skillDir = path.join(tmpDir, "test-skill");
    await fs.mkdir(skillDir, { recursive: true });

    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        'name: test-skill',
        'description: "A test skill"',
        'allowed-tools:',
        '  - Read',
        '  - Write',
        'max-turns: 10',
        "---",
        "",
        "# Test Skill Prompt",
        "",
        "Do the thing.",
      ].join("\n"),
      "utf-8",
    );

    const skills = await loadSkills(tmpDir);

    expect(skills["test-skill"]).toBeDefined();
    expect(skills["test-skill"].description).toBe("A test skill");
    expect(skills["test-skill"].allowedTools).toEqual(["Read", "Write"]);
    expect(skills["test-skill"].maxTurns).toBe(10);
    expect(skills["test-skill"].prompt).toContain("# Test Skill Prompt");
    expect(skills["test-skill"].prompt).toContain("Do the thing.");

    // Cleanup
    await fs.rm(tmpDir, { recursive: true });
  });

  it("loads templates from assets/ directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-tmpl-"));
    const skillDir = path.join(tmpDir, "tmpl-skill");
    const assetsDir = path.join(skillDir, "assets");
    await fs.mkdir(assetsDir, { recursive: true });

    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: tmpl-skill\ndescription: test\n---\nPrompt body.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(assetsDir, "template.json"),
      '{"key": "value"}',
      "utf-8",
    );

    const skills = await loadSkills(tmpDir);
    expect(skills["tmpl-skill"].prompt).toContain("Reference Templates");
    expect(skills["tmpl-skill"].prompt).toContain("template.json");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("loads references from references/ directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-ref-"));
    const skillDir = path.join(tmpDir, "ref-skill");
    const refsDir = path.join(skillDir, "references");
    await fs.mkdir(refsDir, { recursive: true });

    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: ref-skill\ndescription: test\n---\nBody.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(refsDir, "guide.md"),
      "# Reference Guide\n\nSome docs.",
      "utf-8",
    );

    const skills = await loadSkills(tmpDir);
    expect(skills["ref-skill"].prompt).toContain("Reference Documents");
    expect(skills["ref-skill"].prompt).toContain("Reference Guide");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("skips files without name in frontmatter", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-noname-"));
    const skillDir = path.join(tmpDir, "noname-skill");
    await fs.mkdir(skillDir, { recursive: true });

    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\ndescription: no name\n---\nBody.",
      "utf-8",
    );

    const skills = await loadSkills(tmpDir);
    expect(Object.keys(skills)).toHaveLength(0);

    await fs.rm(tmpDir, { recursive: true });
  });
});
