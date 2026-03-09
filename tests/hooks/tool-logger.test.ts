import { describe, it, expect, vi, beforeEach } from "vitest";

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
}));
vi.mock("../../src/protocol.js", () => ({
  emit: emitMock,
}));

import { createToolLogger } from "../../src/hooks/tool-logger.js";

describe("createToolLogger", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  it("emits tool_log pre event on preToolUse", async () => {
    const logger = createToolLogger();
    await logger.preToolUse({
      tool_name: "Read",
      tool_input: { file_path: "/workspace/test.txt" },
    });

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_log",
        tool: "Read",
        phase: "pre",
      }),
    );
  });

  it("emits tool_log post event on postToolUse", async () => {
    const logger = createToolLogger();
    await logger.postToolUse({
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: "file1.txt",
    });

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_log",
        tool: "Bash",
        phase: "post",
      }),
    );
  });

  it("includes agent name when set", async () => {
    const logger = createToolLogger("script-writer");
    await logger.preToolUse({ tool_name: "Write", tool_input: {} });

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "script-writer" }),
    );
  });

  it("includes detail for file operations", async () => {
    const logger = createToolLogger();
    await logger.preToolUse({
      tool_name: "Read",
      tool_input: { file_path: "/workspace/test.txt" },
    });

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ path: "/workspace/test.txt" }),
      }),
    );
  });

  it("truncates long bash commands in detail", async () => {
    const logger = createToolLogger();
    const longCmd = "x".repeat(200);
    await logger.preToolUse({
      tool_name: "Bash",
      tool_input: { command: longCmd },
    });

    const call = emitMock.mock.calls[0][0];
    expect(call.detail.command.length).toBeLessThanOrEqual(120);
  });

  it("omits detail when no relevant fields", async () => {
    const logger = createToolLogger();
    await logger.preToolUse({ tool_name: "Agent", tool_input: { description: "test" } });

    const call = emitMock.mock.calls[0][0];
    expect(call.detail).toBeUndefined();
  });
});
