// input: buildAgentOptions function
// output: Tests for agent options construction logic
// pos: Unit test — validates agent session configuration

import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildAgentOptions } from "../src/agent-options.js";

const BASE_OPTIONS = {
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: "Orchestrator prompt content",
  },
  mcpServers: {
    image: { name: "image" },
    switch: { name: "switch" },
  },
  allowedTools: ["Read", "Write"],
  model: "claude-sonnet-4-6",
  cwd: "/workspace",
  agents: { screenwriter: { description: "editor" } },
  maxBudgetUsd: 10.0,
  betas: ["context-1m-2025-08-07"],
  permissionMode: "default",
  disallowedTools: ["Bash", "Write"],
  resume: "orch-session-123",
  continue: true,
  maxTurns: 30,
  hooks: {
    PreToolUse: [{ hooks: [] }],
    PostToolUse: [{ hooks: [] }],
  },
};

describe("buildAgentOptions", () => {
  it("strips orchestrator system prompt", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");
    const prompt = opts.systemPrompt as { append: string };
    expect(prompt.append).not.toContain("Orchestrator prompt");
    expect(prompt.append).toContain("PROJECT_DIR=/workspace");
  });

  it("injects workspace snapshot into agent prompt", async () => {
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      path.resolve("workspace"),
      "screenwriter",
    );
    const prompt = opts.systemPrompt as { append: string };
    // describeWorkspace() output starts with "## Workspace"
    expect(prompt.append).toContain("## Workspace");
  });

  it("sets cwd to agent directory", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");
    expect(opts.cwd).toBe(path.resolve("/agents", "screenwriter"));
  });

  it("sets settingSources to project", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");
    expect(opts.settingSources).toEqual(["project"]);
  });

  it("removes agents routing map from agent options", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");
    expect(opts.agents).toBeUndefined();
  });

  it("preserves model and other base options", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");
    expect(opts.model).toBe("claude-sonnet-4-6");
    expect(opts.maxBudgetUsd).toBe(10.0);
    expect(opts.betas).toEqual(["context-1m-2025-08-07"]);
    expect(opts.maxTurns).toBe(200); // agent's own limit, not orchestrator's 30
  });

  it("agent prompt supports both interactive and dispatched modes", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");
    const prompt = opts.systemPrompt as { append: string };
    expect(prompt.append).toContain("Stay in this agent conversation after finishing the task");
    // Worker prompt includes return_to_main for orchestrator-dispatched mode
    expect(prompt.append).toContain("return_to_main");
  });

  it("strips agent field from options", async () => {
    const withAgent = { ...BASE_OPTIONS, agent: "old-agent" };
    const opts = await buildAgentOptions(withAgent, "/agents", "/workspace", "art-director");
    // agent field must NOT be passed to SDK — it requires a matching agents map entry
    expect(opts.agent).toBeUndefined();
  });

  it("does not inherit main permission policy but keeps hooks", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");

    expect(opts.allowedTools).toBeUndefined();
    expect(opts.disallowedTools).toBeUndefined();
    expect(opts.permissionMode).toBe("bypassPermissions");
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
    // Hooks are kept — sub-agents need schema validation and tool logging
    expect(opts.hooks).toBeDefined();
  });

  it("does not leak orchestrator resume/continue to sub-agent", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");
    expect(opts.resume).toBeUndefined();
    expect(opts.continue).toBeUndefined();
  });

  it("omits mcpServers (freshMcpServers provides them per-query)", async () => {
    const opts = await buildAgentOptions(BASE_OPTIONS, "/agents", "/workspace", "screenwriter");
    expect(opts.mcpServers).toBeUndefined();
  });
});
