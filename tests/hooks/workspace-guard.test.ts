import { describe, expect, it, beforeEach } from "vitest";
import { workspaceGuard, setWorkspaceRoot } from "../../src/hooks/workspace-guard.js";

describe("workspaceGuard", () => {
  beforeEach(() => {
    setWorkspaceRoot("/tmp/test-workspace");
  });

  it("allows writes inside workspace", async () => {
    const result = await workspaceGuard({
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test-workspace/output/script.json" },
    });
    expect(result.permissionDecision).toBeUndefined();
  });

  it("denies writes outside workspace", async () => {
    const result = await workspaceGuard({
      tool_name: "Write",
      tool_input: { file_path: "/etc/passwd" },
    });
    expect(result.permissionDecision).toBe("deny");
    expect(result.reason).toContain("outside workspace");
  });

  it("allows reads (no restriction on reads)", async () => {
    const result = await workspaceGuard({
      tool_name: "Read",
      tool_input: { file_path: "/etc/hosts" },
    });
    expect(result.permissionDecision).toBeUndefined();
  });

  it("denies MCP storage writes escaping workspace", async () => {
    const result = await workspaceGuard({
      tool_name: "mcp__storage__write_json",
      tool_input: { path: "../../etc/evil.json" },
    });
    expect(result.permissionDecision).toBe("deny");
    expect(result.reason).toContain("escapes workspace");
  });

  it("allows MCP storage writes inside workspace", async () => {
    const result = await workspaceGuard({
      tool_name: "mcp__storage__write_json",
      tool_input: { path: "output/script.json" },
    });
    expect(result.permissionDecision).toBeUndefined();
  });

  it("passes through non-write tools", async () => {
    const result = await workspaceGuard({
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    });
    expect(result.permissionDecision).toBeUndefined();
  });
});
