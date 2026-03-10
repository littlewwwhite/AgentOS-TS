import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies before importing the module under test
vi.mock("../src/agent-manifest.js", () => ({
  loadAgentManifests: vi.fn().mockResolvedValue({
    "script-writer": {
      name: "script-writer",
      description: "Writes scripts",
      skills: ["script-writing"],
      mcpServers: ["storage", "script"],
    },
  }),
}));

vi.mock("../src/tools/index.js", () => ({
  createToolServers: vi.fn(() => ({})),
}));

vi.mock("../src/hooks/index.js", () => ({
  buildHooks: vi.fn().mockReturnValue({
    PreToolUse: [],
    PostToolUse: [],
  }),
}));

import { createToolServers } from "../src/tools/index.js";
import { buildOptions, describeAgentList, describeWorkspace, WORKSPACE_DIRS } from "../src/options.js";

const mockCreateToolServers = createToolServers as ReturnType<typeof vi.fn>;

describe("buildOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns SDK-compatible options with required fields", async () => {
    const opts = await buildOptions("/tmp/test-ws", "agents");

    expect(opts).toHaveProperty("agents");
    expect(opts).toHaveProperty("mcpServers");
    expect(opts).toHaveProperty("allowedTools");
    expect(opts).toHaveProperty("hooks");
    expect(opts).toHaveProperty("systemPrompt");
    expect(opts).toHaveProperty("cwd", "/tmp/test-ws");
    expect(opts).toHaveProperty("permissionMode", "dontAsk");
    expect(opts).toHaveProperty("includePartialMessages", true);
    expect(opts).toHaveProperty("maxTurns", 30);
  });

  it("requests MCP tool servers and avoids bypass permissions for the main session", async () => {
    const toolServers = {
      storage: { name: "storage" },
      image: { name: "image" },
    };
    mockCreateToolServers.mockReturnValueOnce(toolServers);

    const opts = await buildOptions("/tmp/test-ws", "agents");

    expect(mockCreateToolServers).toHaveBeenCalledWith([]);
    expect(opts.mcpServers).toBe(toolServers);
    expect(opts.permissionMode).toBe("dontAsk");
    expect(opts.disallowedTools).toEqual(
      expect.arrayContaining(["Bash", "Write"]),
    );
  });

  it("does NOT include canUseTool (sandbox replaces permissions)", async () => {
    const opts = await buildOptions("/tmp/test-ws", "agents");
    expect(opts).not.toHaveProperty("canUseTool");
  });

  it("uses buildHooks for hook configuration", async () => {
    const { buildHooks } = await import("../src/hooks/index.js");
    const opts = await buildOptions("/tmp/test-ws", "agents");
    expect(buildHooks).toHaveBeenCalledWith();
    expect(opts.maxBudgetUsd).toBe(10.0);
  });

  it("includes agent list in systemPrompt from loadAgentConfigs", async () => {
    const opts = await buildOptions("/tmp/test-ws", "agents");
    const prompt = opts.systemPrompt as { append: string };
    expect(prompt.append).toContain("Sub-Agents");
    expect(prompt.append).toContain("script-writer");
  });

  it("passes through model, resume, continue", async () => {
    const opts = await buildOptions("/tmp/test-ws", "agents", "opus", "sess-123", true);
    expect(opts.model).toBe("opus");
    expect(opts.resume).toBe("sess-123");
    expect(opts.continue).toBe(true);
  });

  it("defaults continue to false", async () => {
    const opts = await buildOptions("/tmp/test-ws", "agents");
    expect(opts.continue).toBe(false);
  });
});

describe("describeAgentList", () => {
  it("returns empty string for no agents", () => {
    expect(describeAgentList({})).toBe("");
  });

  it("formats agent entries", () => {
    const result = describeAgentList({
      writer: { description: "Writes content" },
      editor: { description: "Edits content" },
    });
    expect(result).toContain("writer");
    expect(result).toContain("Writes content");
    expect(result).toContain("editor");
    expect(result).toContain("Sub-Agents");
  });
});

describe("WORKSPACE_DIRS", () => {
  it("includes expected directories", () => {
    expect(WORKSPACE_DIRS).toContain("draft");
    expect(WORKSPACE_DIRS).toContain("output");
    expect(WORKSPACE_DIRS).toContain("assets");
  });
});
