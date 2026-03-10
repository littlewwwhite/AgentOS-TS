// input: buildAgentOptions function
// output: Tests for agent options construction logic
// pos: Unit test — validates agent session configuration

import { describe, it, expect } from "vitest";
import { buildAgentOptions } from "../src/agent-options.js";
import path from "node:path";

const BASE_OPTIONS = {
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: "Orchestrator prompt content",
  },
  mcpServers: {
    storage: { name: "storage" },
    image: { name: "image" },
    switch: { name: "switch" },
  },
  allowedTools: ["Read", "Write"],
  model: "claude-sonnet-4-6",
  cwd: "/workspace",
  agents: { screenwriter: { description: "editor" } },
  maxBudgetUsd: 10.0,
  betas: ["context-1m-2025-08-07"],
};

describe("buildAgentOptions", () => {
  it("strips orchestrator system prompt", async () => {
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      "/workspace",
      "screenwriter",
    );
    const prompt = opts.systemPrompt as { append: string };
    expect(prompt.append).not.toContain("Orchestrator prompt");
    expect(prompt.append).toContain("Project workspace: /workspace/");
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

  it("strips master switch server from MCP servers", async () => {
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      "/workspace",
      "screenwriter",
    );
    const mcp = opts.mcpServers as Record<string, unknown>;
    expect(mcp.switch).toBeUndefined();
    expect(mcp.storage).toBeDefined();
    expect(mcp.image).toBeDefined();
  });

  it("injects extra MCP servers (agent switch server)", async () => {
    const extraMcp = { switch: { name: "agent-switch" } };
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      "/workspace",
      "screenwriter",
      extraMcp,
    );
    const mcp = opts.mcpServers as Record<string, unknown>;
    expect(mcp.switch).toEqual({ name: "agent-switch" });
    expect(mcp.storage).toBeDefined();
  });

  it("sets cwd to agent directory", async () => {
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      "/workspace",
      "screenwriter",
    );
    expect(opts.cwd).toBe(path.resolve("/agents", "screenwriter"));
  });

  it("sets settingSources to project", async () => {
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      "/workspace",
      "screenwriter",
    );
    expect(opts.settingSources).toEqual(["project"]);
  });

  it("removes agents routing map from agent options", async () => {
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      "/workspace",
      "screenwriter",
    );
    expect(opts.agents).toBeUndefined();
  });

  it("preserves model and other base options", async () => {
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      "/workspace",
      "screenwriter",
    );
    expect(opts.model).toBe("claude-sonnet-4-6");
    expect(opts.maxBudgetUsd).toBe(10.0);
    expect(opts.betas).toEqual(["context-1m-2025-08-07"]);
  });

  it("agent prompt includes return_to_main instruction", async () => {
    const opts = await buildAgentOptions(
      BASE_OPTIONS,
      "/agents",
      "/workspace",
      "screenwriter",
    );
    const prompt = opts.systemPrompt as { append: string };
    expect(prompt.append).toContain("return_to_main");
  });

  it("strips agent field from options", async () => {
    const withAgent = { ...BASE_OPTIONS, agent: "old-agent" };
    const opts = await buildAgentOptions(
      withAgent,
      "/agents",
      "/workspace",
      "art-director",
    );
    // agent field must NOT be passed to SDK — it requires a matching agents map entry
    expect(opts.agent).toBeUndefined();
  });
});
