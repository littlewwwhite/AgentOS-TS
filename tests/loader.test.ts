import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadAgentConfigs, loadSkillContents } from "../src/loader.js";

describe("loadAgentConfigs", () => {
  it("returns empty for nonexistent directory", async () => {
    const configs = await loadAgentConfigs("/nonexistent/path");
    expect(Object.keys(configs)).toHaveLength(0);
  });

  it("parses agent config from YAML", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-agent-"));

    await fs.writeFile(
      path.join(tmpDir, "test-agent.yaml"),
      [
        "name: test-agent",
        'description: "A test agent"',
        "allowed-tools:",
        "  - Read",
        "  - Write",
        "max-turns: 10",
        "skills:",
        "  - test-skill",
      ].join("\n"),
      "utf-8",
    );

    const configs = await loadAgentConfigs(tmpDir);

    expect(configs["test-agent"]).toBeDefined();
    expect(configs["test-agent"].description).toBe("A test agent");
    expect(configs["test-agent"].allowedTools).toEqual(["Read", "Write"]);
    expect(configs["test-agent"].maxTurns).toBe(10);
    expect(configs["test-agent"].skills).toEqual(["test-skill"]);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("parses file-policy from YAML", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-policy-"));

    await fs.writeFile(
      path.join(tmpDir, "restricted-agent.yaml"),
      [
        "name: restricted-agent",
        'description: "An agent with file policy"',
        "file-policy:",
        "  readable:",
        "    - output/script.json",
        "    - assets/**",
        "  writable:",
        "    - assets/**",
      ].join("\n"),
      "utf-8",
    );

    const configs = await loadAgentConfigs(tmpDir);

    expect(configs["restricted-agent"].filePolicy).toBeDefined();
    expect(configs["restricted-agent"].filePolicy!.readable).toEqual([
      "output/script.json",
      "assets/**",
    ]);
    expect(configs["restricted-agent"].filePolicy!.writable).toEqual(["assets/**"]);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("returns undefined filePolicy when not specified", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-nopolicy-"));

    await fs.writeFile(
      path.join(tmpDir, "free-agent.yaml"),
      "name: free-agent\ndescription: No restrictions\n",
      "utf-8",
    );

    const configs = await loadAgentConfigs(tmpDir);

    expect(configs["free-agent"].filePolicy).toBeUndefined();

    await fs.rm(tmpDir, { recursive: true });
  });

  it("skips files without name", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-noname-"));

    await fs.writeFile(
      path.join(tmpDir, "bad.yaml"),
      "description: no name\n",
      "utf-8",
    );

    const configs = await loadAgentConfigs(tmpDir);
    expect(Object.keys(configs)).toHaveLength(0);

    await fs.rm(tmpDir, { recursive: true });
  });
});

describe("loadSkillContents", () => {
  it("returns empty for nonexistent directory", async () => {
    const skills = await loadSkillContents("/nonexistent/path");
    expect(Object.keys(skills)).toHaveLength(0);
  });

  it("loads skill prompt from SKILL.md", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-skill-"));
    const skillDir = path.join(tmpDir, "test-skill");
    await fs.mkdir(skillDir, { recursive: true });

    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "# Test Skill\n\nDo the thing.",
      "utf-8",
    );

    const skills = await loadSkillContents(tmpDir);

    expect(skills["test-skill"]).toBeDefined();
    expect(skills["test-skill"].prompt).toContain("# Test Skill");
    expect(skills["test-skill"].prompt).toContain("Do the thing.");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("appends reference hints when references/ exists", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-ref-"));
    const skillDir = path.join(tmpDir, "ref-skill");
    const refsDir = path.join(skillDir, "references");
    await fs.mkdir(refsDir, { recursive: true });

    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "Body.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(refsDir, "guide.md"),
      "# Guide\n\nSome docs.",
      "utf-8",
    );

    const skills = await loadSkillContents(tmpDir);
    expect(skills["ref-skill"].prompt).toContain("Reference Materials");
    expect(skills["ref-skill"].prompt).toContain("references/");

    await fs.rm(tmpDir, { recursive: true });
  });
});
