import { describe, expect, it } from "vitest";
import { createCanUseTool, type AgentFilePolicy } from "../src/permissions.js";

const policies: Record<string, AgentFilePolicy> = {
  "image-create": {
    readable: ["output/script.json", "catalog.json", "assets/**"],
    writable: ["assets/**"],
  },
  "script-writer": {
    readable: ["source.txt", "draft/**", "design.json", "catalog.json"],
    writable: ["draft/**", "design.json", "catalog.json"],
  },
};

const canUseTool = createCanUseTool("/workspace/project", policies);

describe("createCanUseTool", () => {
  it("allows everything for main orchestrator (no agentID)", async () => {
    const result = await canUseTool("Write", { file_path: "/etc/passwd" }, {});
    expect(result.behavior).toBe("allow");
  });

  it("allows everything for unknown agents (no policy)", async () => {
    const result = await canUseTool("Write", { file_path: "foo.json" }, { agentID: "unknown-agent" });
    expect(result.behavior).toBe("allow");
  });

  it("allows writes matching writable globs", async () => {
    const result = await canUseTool(
      "Write",
      { file_path: "/workspace/project/assets/characters/hero.png" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("allow");
  });

  it("denies writes not matching writable globs", async () => {
    const result = await canUseTool(
      "Write",
      { file_path: "/workspace/project/output/script.json" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("cannot write");
  });

  it("allows reads matching readable globs", async () => {
    const result = await canUseTool(
      "Read",
      { file_path: "/workspace/project/output/script.json" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("allow");
  });

  it("denies reads not matching readable globs", async () => {
    const result = await canUseTool(
      "Read",
      { file_path: "/workspace/project/draft/ep01.md" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("cannot read");
  });

  it("denies paths escaping workspace", async () => {
    const result = await canUseTool(
      "Write",
      { file_path: "/workspace/project/../../../etc/passwd" },
      { agentID: "script-writer" },
    );
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("outside workspace");
  });

  it("handles MCP storage tools", async () => {
    const result = await canUseTool(
      "mcp__storage__write_json",
      { path: "assets/manifest.json" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("allow");
  });

  it("allows non-file tools regardless of policy", async () => {
    const result = await canUseTool(
      "Bash",
      { command: "echo test" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("allow");
  });
});
