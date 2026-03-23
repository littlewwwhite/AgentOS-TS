// input: loadAgentConfigs function + agents/*.yaml
// output: Extended loader tests with edge cases
// pos: Unit test — validates YAML agent config loading

import { describe, it, expect, afterEach } from "vitest";
import { loadAgentConfigs } from "../src/loader.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpDir: string;

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("loadAgentConfigs extended", () => {
  it("loads real agents directory", async () => {
    const agents = await loadAgentConfigs(path.resolve("agents"));
    expect(Object.keys(agents).length).toBe(5);
    expect(agents.screenwriter).toBeDefined();
    expect(agents.screenwriter.description).toBeTruthy();
    expect(agents["art-director"]).toBeDefined();
    expect(agents["footage-producer"]).toBeDefined();
    expect(agents["post-processor"]).toBeDefined();
    expect(agents["skill-creator"]).toBeDefined();
  });

  it("screenwriter declares scoped mcp servers in yaml", async () => {
    const agents = await loadAgentConfigs(path.resolve("agents"));
    expect(agents.screenwriter.mcpServers).toEqual(["storage", "viking"]);
  });

  it("supports optional mcp server metadata in yaml", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-test-"));
    await fs.writeFile(
      path.join(tmpDir, "with-mcp.yaml"),
      [
        "name: with-mcp",
        'description: "Has scoped servers"',
        "mcpServers:",
        "  - source",
        "  - image",
      ].join("\n"),
    );

    const agents = await loadAgentConfigs(tmpDir);
    expect(agents["with-mcp"].mcpServers).toEqual(["source", "image"]);
  });

  it("returns empty for non-existent directory", async () => {
    const agents = await loadAgentConfigs("/nonexistent/path/12345");
    expect(Object.keys(agents).length).toBe(0);
  });

  it("skips yaml without name field", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-test-"));
    await fs.writeFile(
      path.join(tmpDir, "noname.yaml"),
      "description: No name agent\nskills: []\n",
    );
    const agents = await loadAgentConfigs(tmpDir);
    expect(Object.keys(agents).length).toBe(0);
  });

  it("handles yaml with only name field", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-test-"));
    await fs.writeFile(path.join(tmpDir, "minimal.yaml"), "name: minimal\n");
    const agents = await loadAgentConfigs(tmpDir);
    expect(agents.minimal).toBeDefined();
    expect(agents.minimal.description).toBe("");
  });

  it("handles mixed yaml and yml extensions", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-test-"));
    await fs.writeFile(
      path.join(tmpDir, "a.yaml"),
      "name: agent-a\ndescription: A\n",
    );
    await fs.writeFile(
      path.join(tmpDir, "b.yml"),
      "name: agent-b\ndescription: B\n",
    );
    const agents = await loadAgentConfigs(tmpDir);
    expect(agents["agent-a"]).toBeDefined();
    expect(agents["agent-b"]).toBeDefined();
  });

  it("ignores non-yaml files", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loader-test-"));
    await fs.writeFile(
      path.join(tmpDir, "agent.yaml"),
      "name: real\ndescription: Real agent\n",
    );
    await fs.writeFile(path.join(tmpDir, "readme.md"), "# Readme\n");
    await fs.writeFile(path.join(tmpDir, "config.json"), "{}");
    const agents = await loadAgentConfigs(tmpDir);
    expect(Object.keys(agents).length).toBe(1);
    expect(agents.real).toBeDefined();
  });
});
