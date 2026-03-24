import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildMainSessionSpec, buildWorkerSessionSpec } from "../src/session-specs.js";

describe("buildMainSessionSpec", () => {
  it("builds a dispatch-first main session spec", async () => {
    const spec = await buildMainSessionSpec({
      projectPath: "/workspace",
      agents: {
        screenwriter: {
          description: "Writes scripts",
          configuredSkills: ["script-adapt", "script-writer"],
        },
      },
    });

    expect(spec.cwd).toBe("/workspace");
    expect(spec.settingSources).toEqual(["project"]);
    expect(spec.allowedTools).toEqual([
      "TodoWrite",
      "mcp__source__prepare_source_project",
      "mcp__switch__switch_to_agent",
      "mcp__workspace__check_workspace",
    ]);
    expect(spec.disallowedTools).toEqual(
      expect.arrayContaining(["Bash", "Write", "Edit", "Read", "NotebookEdit"]),
    );
    expect(spec.permissionMode).toBe("dontAsk");
    expect(spec.mcpServerNames).toEqual(["source", "switch", "workspace"]);
    expect(spec.systemPrompt.append).toContain("PROJECT_DIR=/workspace");
    expect(spec.systemPrompt.append).toContain(
      "Delegate immediately when the request clearly belongs to a single sub-agent",
    );
    expect(spec.systemPrompt.append).toContain(
      "The main agent must not ask domain-specific follow-up questions",
    );
    expect(spec.systemPrompt.append).toContain("Uploaded source files live under /workspace/data/ by default");
    expect(spec.systemPrompt.append).toContain("Use the `prepare_source_project` tool");
  });
});

describe("buildWorkerSessionSpec", () => {
  it("relies on SDK native skill discovery via settingSources, not prompt injection", async () => {
    const spec = await buildWorkerSessionSpec({
      projectPath: "/workspace",
      agentsDir: "agents",
      agentName: "screenwriter",
      manifest: {
        name: "screenwriter",
        description: "Writes scripts",
        skills: ["script-adapt"],
        mcpServers: ["storage", "script"],
      },
    });

    // Skills are discovered natively by SDK from cwd/.claude/skills/ via settingSources
    expect(spec.settingSources).toEqual(["project"]);
    // System prompt should NOT contain injected skill content — SDK handles discovery
    expect(spec.systemPrompt.append).toContain(
      "PROJECT_DIR=/workspace",
    );
    // Auto-execution instructions should be present
    expect(spec.systemPrompt.append).toContain("execute it to completion");
  });

  it("builds a worker session spec without inheriting main restrictions", async () => {
    const spec = await buildWorkerSessionSpec({
      projectPath: "/workspace",
      agentsDir: "agents",
      agentName: "screenwriter",
      manifest: {
        name: "screenwriter",
        description: "Writes scripts",
        skills: ["script-adapt", "script-writer"],
        mcpServers: ["storage", "script"],
      },
    });

    expect(spec.cwd).toBe(path.resolve("agents", "screenwriter"));
    expect(spec.settingSources).toEqual(["project"]);
    expect(spec.allowedTools).toBeUndefined();
    expect(spec.disallowedTools).toBeUndefined();
    expect(spec.permissionMode).toBe("bypassPermissions");
    expect(spec.hooks).toBeUndefined();
    expect(spec.mcpServerNames).toEqual(["storage", "script"]);
    expect(spec.systemPrompt).toMatchObject({
      type: "preset",
      preset: "claude_code",
    });
    expect(spec.systemPrompt.append).toContain(
      "PROJECT_DIR=/workspace",
    );
  });
});
