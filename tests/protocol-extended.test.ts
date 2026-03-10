// input: parseCommand, matchEnterAgent, emit from protocol.ts
// output: Extended protocol tests covering edge cases
// pos: Unit test — comprehensive protocol validation beyond existing tests

import { describe, it, expect } from "vitest";
import { matchEnterAgent, parseCommand } from "../src/protocol.js";

// ---------- matchEnterAgent ----------

describe("matchEnterAgent", () => {
  const agents = ["screenwriter", "art-director", "video-producer", "post-production", "skill-creator"];

  it("matches Chinese 进入 prefix", () => {
    expect(matchEnterAgent("进入screenwriter", agents)).toBe("screenwriter");
  });

  it("matches Chinese 切换到 prefix", () => {
    expect(matchEnterAgent("切换到art-director", agents)).toBe("art-director");
  });

  it("matches English enter prefix", () => {
    expect(matchEnterAgent("enter screenwriter", agents)).toBe("screenwriter");
  });

  it("matches English switch to prefix", () => {
    expect(matchEnterAgent("switch to video-producer", agents)).toBe("video-producer");
  });

  it("is case insensitive for command", () => {
    expect(matchEnterAgent("ENTER screenwriter", agents)).toBe("screenwriter");
    expect(matchEnterAgent("Switch To art-director", agents)).toBe("art-director");
  });

  it("returns null for unknown agent", () => {
    expect(matchEnterAgent("进入unknown-agent", agents)).toBeNull();
  });

  it("returns null for non-matching input", () => {
    expect(matchEnterAgent("hello world", agents)).toBeNull();
    expect(matchEnterAgent("请帮我写一个剧本", agents)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(matchEnterAgent("", agents)).toBeNull();
  });

  it("returns null for just prefix without name", () => {
    expect(matchEnterAgent("进入", agents)).toBeNull();
  });

  it("trims whitespace around agent name", () => {
    expect(matchEnterAgent("进入  screenwriter  ", agents)).toBe("screenwriter");
  });

  it("matches hyphenated agent names", () => {
    expect(matchEnterAgent("进入post-production", agents)).toBe("post-production");
    expect(matchEnterAgent("进入skill-creator", agents)).toBe("skill-creator");
  });
});

// ---------- parseCommand edge cases ----------

describe("parseCommand edge cases", () => {
  it("returns null for empty string", () => {
    expect(parseCommand("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(parseCommand("   ")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseCommand("not json")).toBeNull();
    expect(parseCommand("{broken")).toBeNull();
  });

  it("returns null for JSON array", () => {
    expect(parseCommand("[1,2,3]")).toBeNull();
  });

  it("returns null for JSON primitives", () => {
    expect(parseCommand('"hello"')).toBeNull();
    expect(parseCommand("42")).toBeNull();
    expect(parseCommand("true")).toBeNull();
    expect(parseCommand("null")).toBeNull();
  });

  it("returns null for unknown cmd", () => {
    expect(parseCommand('{"cmd":"unknown"}')).toBeNull();
  });

  it("parses chat with all fields", () => {
    const cmd = parseCommand('{"cmd":"chat","message":"hello","target":"screenwriter","request_id":"r1"}');
    expect(cmd).toEqual({
      cmd: "chat",
      message: "hello",
      target: "screenwriter",
      request_id: "r1",
    });
  });

  it("chat requires non-empty message", () => {
    expect(parseCommand('{"cmd":"chat","message":""}')).toBeNull();
    expect(parseCommand('{"cmd":"chat"}')).toBeNull();
  });

  it("chat ignores empty target", () => {
    const cmd = parseCommand('{"cmd":"chat","message":"hi","target":""}');
    expect(cmd).toEqual({ cmd: "chat", message: "hi" });
    expect((cmd as any).target).toBeUndefined();
  });

  it("enter_agent requires agent field", () => {
    expect(parseCommand('{"cmd":"enter_agent"}')).toBeNull();
    expect(parseCommand('{"cmd":"enter_agent","agent":""}')).toBeNull();
  });

  it("resume requires session_id", () => {
    expect(parseCommand('{"cmd":"resume"}')).toBeNull();
    expect(parseCommand('{"cmd":"resume","session_id":""}')).toBeNull();
  });

  it("simple commands need no extra fields", () => {
    expect(parseCommand('{"cmd":"interrupt"}')).toEqual({ cmd: "interrupt" });
    expect(parseCommand('{"cmd":"status"}')).toEqual({ cmd: "status" });
    expect(parseCommand('{"cmd":"list_skills"}')).toEqual({ cmd: "list_skills" });
    expect(parseCommand('{"cmd":"exit_agent"}')).toEqual({ cmd: "exit_agent" });
  });

  it("extra fields are silently ignored", () => {
    const cmd = parseCommand('{"cmd":"status","extra":"ignored"}');
    expect(cmd).toEqual({ cmd: "status" });
  });

  it("handles unicode in chat message", () => {
    const cmd = parseCommand('{"cmd":"chat","message":"请帮我改编剧本"}');
    expect(cmd).toEqual({ cmd: "chat", message: "请帮我改编剧本" });
  });
});
