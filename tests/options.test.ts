import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// FIXED_MODEL is now a private constant in options.ts — use the known value directly
const FIXED_MODEL = "claude-sonnet-4-6";

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

// Default: no Viking singleton (null). Tests override via initViking/resetViking.
vi.mock("../src/viking/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/viking/index.js")>();
  return { ...actual };
});

import { createToolServers } from "../src/tools/index.js";
import { buildOptions, describeAgentList, describeWorkspace, WORKSPACE_DIRS } from "../src/options.js";
import { initViking, resetViking } from "../src/viking/index.js";

const mockCreateToolServers = createToolServers as ReturnType<typeof vi.fn>;

describe("buildOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    resetViking();
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

    expect(mockCreateToolServers).toHaveBeenCalledWith(["source", "switch", "workspace"]);
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
    expect(prompt.append).toContain("Source materials: /tmp/test-ws/data/");
  });

  it("pins the runtime model while preserving resume and continue", async () => {
    const opts = await buildOptions("/tmp/test-ws", "agents", "opus", "sess-123", true);
    expect(opts.model).toBe(FIXED_MODEL);
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

describe("describeWorkspace — Viking context injection", () => {
  afterEach(() => {
    resetViking();
  });

  it("includes Viking artifact summaries when available", async () => {
    const client = initViking({ url: "http://mock:1933" });
    vi.spyOn(client, "health").mockResolvedValue(true);
    vi.spyOn(client, "find").mockResolvedValue([
      { uri: "file:///ws/draft/ep01.json", score: 0.92, content: "Episode 1 script draft" },
      { uri: "file:///ws/assets/logo.png", score: 0.85, content: "Logo asset" },
    ]);

    const result = await describeWorkspace("/tmp/nonexistent-ws");

    expect(result).toContain("## Shared Context (from OpenViking)");
    expect(result).toContain("file:///ws/draft/ep01.json: Episode 1 script draft (score: 0.92)");
    expect(result).toContain("file:///ws/assets/logo.png: Logo asset (score: 0.85)");
    expect(client.find).toHaveBeenCalledWith("recent artifacts and deliverables", { limit: 10 });
  });

  it("falls back to directory-only when Viking health fails", async () => {
    const client = initViking({ url: "http://mock:1933" });
    vi.spyOn(client, "health").mockResolvedValue(false);
    const findSpy = vi.spyOn(client, "find");

    const result = await describeWorkspace("/tmp/nonexistent-ws");

    expect(result).toContain("## Workspace");
    expect(result).not.toContain("## Shared Context");
    expect(findSpy).not.toHaveBeenCalled();
  });

  it("falls back gracefully when Viking is not initialized", async () => {
    resetViking(); // ensure getVikingClient() returns null

    const result = await describeWorkspace("/tmp/nonexistent-ws");

    expect(result).toContain("## Workspace");
    expect(result).not.toContain("## Shared Context");
  });
});
