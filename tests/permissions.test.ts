import { describe, expect, it } from "vitest";
import {
  createCanUseTool,
  extractBashWriteTargets,
  isInsideWorkspace,
  type AgentFilePolicy,
} from "../src/permissions.js";

// --- extractBashWriteTargets ---

describe("extractBashWriteTargets", () => {
  it("extracts redirect targets (> and >>)", () => {
    expect(extractBashWriteTargets("echo hello > out.txt")).toContain("out.txt");
    expect(extractBashWriteTargets("cat a >> log.txt")).toContain("log.txt");
  });

  it("extracts tee targets", () => {
    const targets = extractBashWriteTargets("echo hello | tee output.log");
    expect(targets).toContain("output.log");
  });

  it("extracts cp destination", () => {
    const targets = extractBashWriteTargets("cp src.txt dest.txt");
    expect(targets).toContain("dest.txt");
  });

  it("extracts mv destination", () => {
    const targets = extractBashWriteTargets("mv old.txt new.txt");
    expect(targets).toContain("new.txt");
  });

  it("extracts rm targets", () => {
    const targets = extractBashWriteTargets("rm file1.txt file2.txt");
    expect(targets).toContain("file1.txt");
    expect(targets).toContain("file2.txt");
  });

  it("extracts touch targets", () => {
    const targets = extractBashWriteTargets("touch newfile.txt");
    expect(targets).toContain("newfile.txt");
  });

  it("extracts mkdir targets", () => {
    const targets = extractBashWriteTargets("mkdir newdir");
    expect(targets).toContain("newdir");
  });

  it("returns empty for read-only commands", () => {
    expect(extractBashWriteTargets("cat file.txt")).toEqual([]);
    expect(extractBashWriteTargets("ls -la")).toEqual([]);
    expect(extractBashWriteTargets("echo hello")).toEqual([]);
    expect(extractBashWriteTargets("grep pattern file.txt")).toEqual([]);
  });

  it("skips /dev/ targets from redirections", () => {
    expect(extractBashWriteTargets("echo x > /dev/null")).toEqual([]);
  });

  it("handles chained commands", () => {
    const targets = extractBashWriteTargets("echo a > x.txt && cp y.txt z.txt");
    expect(targets).toContain("x.txt");
    expect(targets).toContain("z.txt");
  });
});

// --- isInsideWorkspace ---

describe("isInsideWorkspace", () => {
  it("returns true for paths inside workspace", () => {
    expect(isInsideWorkspace("/workspace/project/file.txt", "/workspace/project")).toBe(true);
  });

  it("returns true for workspace root itself", () => {
    expect(isInsideWorkspace("/workspace/project", "/workspace/project")).toBe(true);
  });

  it("returns false for paths outside workspace", () => {
    expect(isInsideWorkspace("/etc/passwd", "/workspace/project")).toBe(false);
  });

  it("returns false for sibling paths", () => {
    expect(isInsideWorkspace("/workspace/other/file.txt", "/workspace/project")).toBe(false);
  });
});

// --- createCanUseTool ---

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

  it("denies workspace escape for agents without policy", async () => {
    const result = await canUseTool(
      "Write",
      { file_path: "/etc/passwd" },
      { agentID: "unknown-agent" },
    );
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("outside workspace");
  });

  it("allows writes inside workspace for agents without policy", async () => {
    const result = await canUseTool(
      "Write",
      { file_path: "/workspace/project/any/file.txt" },
      { agentID: "unknown-agent" },
    );
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

  // --- Bash interception ---

  it("allows Bash without write operations", async () => {
    const result = await canUseTool(
      "Bash",
      { command: "echo test" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("allow");
  });

  it("allows Bash read-only commands (ls, cat, grep)", async () => {
    const result = await canUseTool(
      "Bash",
      { command: "ls -la && cat file.txt" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("allow");
  });

  it("denies Bash writes outside workspace", async () => {
    const result = await canUseTool(
      "Bash",
      { command: "echo evil > /etc/crontab" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("escapes workspace");
  });

  it("denies Bash workspace escape for agents without policy", async () => {
    const result = await canUseTool(
      "Bash",
      { command: "cp local.txt /tmp/stolen.txt" },
      { agentID: "unknown-agent" },
    );
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("escapes workspace");
  });

  it("denies Bash writes not matching writable globs", async () => {
    const result = await canUseTool(
      "Bash",
      { command: "echo x > output/script.json" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("Bash cannot write");
  });

  it("allows Bash writes matching writable globs", async () => {
    const result = await canUseTool(
      "Bash",
      { command: "echo x > assets/new.json" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("allow");
  });

  it("allows non-file tools regardless of policy", async () => {
    const result = await canUseTool(
      "Glob",
      { pattern: "**/*.json" },
      { agentID: "image-create" },
    );
    expect(result.behavior).toBe("allow");
  });
});
