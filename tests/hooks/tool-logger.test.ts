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

  it("emits tool_log with agent metadata from hook input", async () => {
    const logger = createToolLogger();
    await logger.preToolUse({
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace/agents/screenwriter",
      agent_type: "screenwriter",
      tool_name: "Read",
      tool_input: { file_path: "/workspace/test.txt" },
      tool_use_id: "tool-1",
      transcript_path: "/tmp/transcript.jsonl",
    });

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_log",
        tool: "Read",
        phase: "pre",
        agent: "screenwriter",
        detail: expect.objectContaining({
          path: "/workspace/test.txt",
          session_id: "sess-1",
          cwd: "/workspace/agents/screenwriter",
        }),
      }),
    );
  });

  it("emits tool_log post event on postToolUse", async () => {
    const logger = createToolLogger();
    await logger.postToolUse({
      hook_event_name: "PostToolUse",
      session_id: "sess-2",
      cwd: "/workspace/agents/screenwriter",
      agent_type: "screenwriter",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: "file1.txt",
      tool_use_id: "tool-2",
      transcript_path: "/tmp/transcript.jsonl",
    });

    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_log",
        tool: "Bash",
        phase: "post",
        agent: "screenwriter",
      }),
    );
  });

  it("includes detail for file operations", async () => {
    const logger = createToolLogger();
    await logger.preToolUse({
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace",
      tool_name: "Read",
      tool_input: { file_path: "/workspace/test.txt" },
      tool_use_id: "tool-3",
      transcript_path: "/tmp/transcript.jsonl",
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
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace",
      tool_name: "Bash",
      tool_input: { command: longCmd },
      tool_use_id: "tool-4",
      transcript_path: "/tmp/transcript.jsonl",
    });

    const call = emitMock.mock.calls[0][0];
    expect(call.detail.command.length).toBeLessThanOrEqual(120);
  });

  it("always includes native session detail even without tool-specific fields", async () => {
    const logger = createToolLogger();
    await logger.preToolUse({
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace",
      tool_name: "Agent",
      tool_input: { description: "test" },
      tool_use_id: "tool-5",
      transcript_path: "/tmp/transcript.jsonl",
    });

    const call = emitMock.mock.calls[0][0];
    expect(call.detail).toEqual(
      expect.objectContaining({
        session_id: "sess-1",
        cwd: "/workspace",
      }),
    );
  });
});
