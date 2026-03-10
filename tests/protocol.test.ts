import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit, parseCommand } from "../src/protocol.js";
import type { SandboxEvent } from "../src/protocol.js";

describe("parseCommand", () => {
  it("parses a valid chat command", () => {
    expect(parseCommand('{"cmd":"chat","message":"hello"}')).toEqual({
      cmd: "chat",
      message: "hello",
    });
  });

  it("parses interrupt command", () => {
    expect(parseCommand('{"cmd":"interrupt"}')).toEqual({ cmd: "interrupt" });
  });

  it("parses status command", () => {
    expect(parseCommand('{"cmd":"status"}')).toEqual({ cmd: "status" });
  });

  it("parses list_skills command", () => {
    expect(parseCommand('{"cmd":"list_skills"}')).toEqual({
      cmd: "list_skills",
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseCommand("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCommand("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseCommand("   ")).toBeNull();
  });

  it("returns null when cmd field is missing", () => {
    expect(parseCommand('{"message":"hello"}')).toBeNull();
  });

  it("returns null for unknown cmd value", () => {
    expect(parseCommand('{"cmd":"unknown"}')).toBeNull();
  });

  it("returns null for chat without message", () => {
    expect(parseCommand('{"cmd":"chat"}')).toBeNull();
  });

  it("returns null for chat with empty message", () => {
    expect(parseCommand('{"cmd":"chat","message":""}')).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseCommand("42")).toBeNull();
    expect(parseCommand('"string"')).toBeNull();
    expect(parseCommand("null")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseCommand('  {"cmd":"status"}  ')).toEqual({ cmd: "status" });
  });

  it("parses chat command with target and request_id", () => {
    expect(
      parseCommand('{"cmd":"chat","message":"hello","target":"script-writer","request_id":"r1"}'),
    ).toEqual({
      cmd: "chat",
      message: "hello",
      target: "script-writer",
      request_id: "r1",
    });
  });

  it("parses enter_agent command", () => {
    expect(parseCommand('{"cmd":"enter_agent","agent":"script-writer"}')).toEqual({
      cmd: "enter_agent",
      agent: "script-writer",
    });
  });

  it("returns null for enter_agent without agent field", () => {
    expect(parseCommand('{"cmd":"enter_agent"}')).toBeNull();
  });

  it("parses exit_agent command", () => {
    expect(parseCommand('{"cmd":"exit_agent"}')).toEqual({ cmd: "exit_agent" });
  });

  it("parses resume command with session_id", () => {
    expect(parseCommand('{"cmd":"resume","session_id":"abc-123"}')).toEqual({
      cmd: "resume",
      session_id: "abc-123",
    });
  });

  it("returns null for resume without session_id", () => {
    expect(parseCommand('{"cmd":"resume"}')).toBeNull();
  });

  it("parses chat with only target (no request_id)", () => {
    expect(parseCommand('{"cmd":"chat","message":"hi","target":"writer"}')).toEqual({
      cmd: "chat",
      message: "hi",
      target: "writer",
    });
  });

  it("strips empty-string target and request_id from chat", () => {
    const result = parseCommand('{"cmd":"chat","message":"hi","target":"","request_id":""}');
    expect(result).toEqual({ cmd: "chat", message: "hi" });
  });

  it("returns null for enter_agent with empty agent string", () => {
    expect(parseCommand('{"cmd":"enter_agent","agent":""}')).toBeNull();
  });

  it("returns null for resume with empty session_id string", () => {
    expect(parseCommand('{"cmd":"resume","session_id":""}')).toBeNull();
  });
});

describe("emit", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("writes JSON followed by newline", () => {
    const event: SandboxEvent = { type: "ready", skills: ["a", "b"] };
    emit(event);
    expect(writeSpy).toHaveBeenCalledWith('{"type":"ready","skills":["a","b"]}\n');
  });

  it("emits error event correctly", () => {
    const event: SandboxEvent = { type: "error", message: "boom" };
    emit(event);
    expect(writeSpy).toHaveBeenCalledWith('{"type":"error","message":"boom"}\n');
  });

  it("emits result event with all fields", () => {
    const event: SandboxEvent = {
      type: "result",
      cost: 0.01,
      duration_ms: 1500,
      session_id: "abc-123",
      is_error: false,
    };
    emit(event);
    const output = (writeSpy.mock.calls[0] as string[])[0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(event);
  });

  it("emits agent_entered event with agent field", () => {
    const event: SandboxEvent = { type: "agent_entered", agent: "writer" };
    emit(event);
    const output = (writeSpy.mock.calls[0] as string[])[0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual({ type: "agent_entered", agent: "writer" });
  });

  it("emits tool_log event with detail", () => {
    const event: SandboxEvent = {
      type: "tool_log",
      tool: "Read",
      phase: "pre",
      detail: { path: "/test" },
      agent: "writer",
    };
    emit(event);
    const output = (writeSpy.mock.calls[0] as string[])[0];
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("tool_log");
    expect(parsed.agent).toBe("writer");
  });

  it("emits thinking event correctly", () => {
    const event: SandboxEvent = {
      type: "thinking",
      text: "Need to inspect the source file first.",
      agent: "writer",
    };
    emit(event);
    const output = (writeSpy.mock.calls[0] as string[])[0];
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(event);
  });
});
