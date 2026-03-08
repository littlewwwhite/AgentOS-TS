import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseCommand, emit } from "../src/protocol.js";
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
    expect(writeSpy).toHaveBeenCalledWith(
      '{"type":"ready","skills":["a","b"]}\n',
    );
  });

  it("emits error event correctly", () => {
    const event: SandboxEvent = { type: "error", message: "boom" };
    emit(event);
    expect(writeSpy).toHaveBeenCalledWith(
      '{"type":"error","message":"boom"}\n',
    );
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
});
