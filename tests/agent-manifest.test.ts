import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadAgentManifests } from "../src/agent-manifest.js";

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  }
});

describe("loadAgentManifests", () => {
  it("loads skill names only from .claude/skills and merges explicit routing metadata", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-manifest-"));
    await fs.writeFile(
      path.join(tmpDir, "screenwriter.yaml"),
      [
        "name: screenwriter",
        'description: "Writes scripts"',
        "skills:",
        "  - legacy-yaml-skill",
        "mcpServers:",
        "  - script",
      ].join("\n"),
      "utf-8",
    );

    const skillsDir = path.join(tmpDir, "screenwriter", ".claude", "skills");
    await fs.mkdir(path.join(skillsDir, "script-adapt"), { recursive: true });
    await fs.writeFile(path.join(skillsDir, "script-adapt", "SKILL.md"), "# script-adapt\n", "utf-8");
    await fs.mkdir(path.join(skillsDir, "script-writer"), { recursive: true });
    await fs.writeFile(path.join(skillsDir, "script-writer", "SKILL.md"), "# script-writer\n", "utf-8");

    const manifests = await loadAgentManifests(tmpDir);

    expect(manifests.screenwriter).toEqual({
      name: "screenwriter",
      description: "Writes scripts",
      skills: ["script-adapt", "script-writer"],
      mcpServers: ["script"],
    });
  });

  it("does not infer mcp servers when yaml metadata is absent", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-manifest-"));
    await fs.writeFile(
      path.join(tmpDir, "screenwriter.yaml"),
      [
        "name: screenwriter",
        'description: "Writes scripts"',
      ].join("\n"),
      "utf-8",
    );

    const skillsDir = path.join(tmpDir, "screenwriter", ".claude", "skills");
    await fs.mkdir(path.join(skillsDir, "script-writer"), { recursive: true });
    await fs.writeFile(path.join(skillsDir, "script-writer", "SKILL.md"), "# script-writer\n", "utf-8");

    const manifests = await loadAgentManifests(tmpDir);

    expect(manifests.screenwriter).toEqual({
      name: "screenwriter",
      description: "Writes scripts",
      skills: ["script-writer"],
      mcpServers: [],
    });
  });
});
