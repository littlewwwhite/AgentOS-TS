// input: Agents directory structure after pipeline optimization
// output: Verifies architecture invariants
// pos: Integration test — validates 5-agent + production/ architecture

import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const AGENTS_DIR = path.resolve("agents");

// Expected 3 agents: screenwriter + director + producer
const EXPECTED_AGENTS = [
  "director",
  "producer",
  "screenwriter",
];

// Agents that MUST NOT have YAML configs (truly deleted)
const DELETED_AGENTS = ["art-director", "footage-producer", "post-processor", "video-editor", "post-production", "video-producer", "skill-creator"];

describe("pipeline architecture: agent structure", () => {
  it("has exactly the expected agent manifests", async () => {
    const entries = await fs.readdir(AGENTS_DIR);
    const yamls = entries
      .filter((e) => e.endsWith(".yaml"))
      .map((e) => e.replace(".yaml", ""))
      .sort();
    expect(yamls).toEqual(EXPECTED_AGENTS);
  });

  it("each agent has .claude/ directory", async () => {
    for (const agent of EXPECTED_AGENTS) {
      const claudeDir = path.join(AGENTS_DIR, agent, ".claude");
      const exists = await fs.access(claudeDir).then(() => true).catch(() => false);
      expect(exists, `${agent}/.claude should exist`).toBe(true);
    }
  });

  it("deleted agents have no YAML configs", async () => {
    for (const agent of DELETED_AGENTS) {
      const yamlPath = path.join(AGENTS_DIR, `${agent}.yaml`);
      const exists = await fs.access(yamlPath).then(() => true).catch(() => false);
      expect(exists, `${agent}.yaml should NOT exist`).toBe(false);
    }
  });
});

describe("pipeline architecture: producer skill modules", () => {
  const PRODUCER_SKILLS = path.resolve("agents", "producer", ".claude", "skills");
  const EXPECTED_MODULES = [
    "asset-gen",
    "music-matcher",
    "subtitle-maker",
    "video-editing",
    "video-gen",
  ];

  it("producer has all expected skill modules", async () => {
    const entries = await fs.readdir(PRODUCER_SKILLS);
    const dirs = entries.filter((e) => !e.startsWith(".")).sort();
    expect(dirs).toEqual(EXPECTED_MODULES);
  });

  it("each module has scripts/ directory", async () => {
    for (const mod of EXPECTED_MODULES) {
      const scriptsDir = path.join(PRODUCER_SKILLS, mod, "scripts");
      const exists = await fs.access(scriptsDir).then(() => true).catch(() => false);
      expect(exists, `producer/skills/${mod}/scripts should exist`).toBe(true);
    }
  });
});

describe("pipeline architecture: shared infrastructure", () => {
  it("_shared/awb-auth/auth.py exists", async () => {
    const p = path.resolve("_shared", "awb-auth", "auth.py");
    const stat = await fs.stat(p);
    expect(stat.isFile()).toBe(true);
  });

  it("scripts/run_production.py exists", async () => {
    const p = path.resolve("_shared", "scripts", "run_production.py");
    const exists = await fs.access(p).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("scripts/storyboard_batch.py exists", async () => {
    const p = path.resolve("_shared", "scripts", "storyboard_batch.py");
    const exists = await fs.access(p).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});
