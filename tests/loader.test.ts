import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadAgentConfigs } from "../src/loader.js";

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
        "skills:",
        "  - test-skill",
      ].join("\n"),
      "utf-8",
    );

    const configs = await loadAgentConfigs(tmpDir);

    expect(configs["test-agent"]).toBeDefined();
    expect(configs["test-agent"].description).toBe("A test agent");
    expect(configs["test-agent"].skills).toEqual(["test-skill"]);

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
