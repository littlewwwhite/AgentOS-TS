import { describe, expect, it } from "vitest";
import { schemaValidator } from "../../src/hooks/schema-validator.js";

describe("schemaValidator", () => {
  it("passes through non-write tools", async () => {
    const result = await schemaValidator({
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace",
      tool_name: "mcp__storage__read_json",
      tool_input: { path: "design.json" },
      tool_use_id: "tool-1",
      transcript_path: "/tmp/transcript.jsonl",
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("passes through write_json for unknown paths", async () => {
    const result = await schemaValidator({
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace",
      tool_name: "mcp__storage__write_json",
      tool_input: { path: "random/file.json", data: "{}" },
      tool_use_id: "tool-2",
      transcript_path: "/tmp/transcript.jsonl",
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("validates design.json against DesignSchema", async () => {
    const validData = {
      title: "Test Project",
      worldview: "A fantasy world",
      style: "anime",
      total_episodes: 1,
      episodes: [{
        episode: 1,
        title: "Episode 1",
        main_plot: "plot",
        climax: "climax",
        cliffhanger: "cliffhanger",
        scenes: [],
      }],
    };
    const result = await schemaValidator({
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace",
      tool_name: "mcp__storage__write_json",
      tool_input: { path: "workspace/design.json", data: JSON.stringify(validData) },
      tool_use_id: "tool-3",
      transcript_path: "/tmp/transcript.jsonl",
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("denies invalid design.json", async () => {
    const invalidData = { title: 123 }; // title should be string
    const result = await schemaValidator({
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace",
      tool_name: "mcp__storage__write_json",
      tool_input: { path: "workspace/design.json", data: JSON.stringify(invalidData) },
      tool_use_id: "tool-4",
      transcript_path: "/tmp/transcript.jsonl",
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("Schema validation failed");
  });

  it("handles data as object (not string)", async () => {
    const validData = {
      title: "Test",
      worldview: "world",
      style: "style",
      total_episodes: 0,
      episodes: [],
    };
    const result = await schemaValidator({
      hook_event_name: "PreToolUse",
      session_id: "sess-1",
      cwd: "/workspace",
      tool_name: "mcp__storage__write_json",
      tool_input: { path: "project/design.json", data: validData },
      tool_use_id: "tool-5",
      transcript_path: "/tmp/transcript.jsonl",
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });
});
