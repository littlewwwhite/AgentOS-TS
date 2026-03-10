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
    expect(spec.allowedTools).toEqual(["TodoWrite", "mcp__switch__switch_to_agent"]);
    expect(spec.disallowedTools).toEqual(
      expect.arrayContaining(["Bash", "Write", "Edit", "NotebookEdit"]),
    );
    expect(spec.permissionMode).toBe("default");
    expect(spec.mcpServerNames).toEqual(["switch"]);
    expect(spec.systemPrompt.append).toContain("conversation focus stays with that sub-agent");
    expect(spec.systemPrompt.append).toContain(
      "Delegate immediately when the request clearly belongs to a single sub-agent",
    );
    expect(spec.systemPrompt.append).toContain(
      "The main agent must not ask domain-specific follow-up questions",
    );
  });
});

describe("buildWorkerSessionSpec", () => {
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
      "Stay in this agent conversation after finishing the task",
    );
    expect(spec.systemPrompt.append).not.toContain("return_to_main");
  });
});
