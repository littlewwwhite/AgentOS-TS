import { describe, expect, it } from "vitest";

import { renderSandboxEvent } from "../src/e2b-repl-render.js";
import { createInitialReplState } from "../src/e2b-repl-state.js";

const plainPalette = {
  dim: (text: string) => text,
  cyan: (text: string) => text,
  yellow: (text: string) => text,
  red: (text: string) => text,
  bold: (text: string) => text,
  magenta: (text: string) => text,
  green: (text: string) => text,
  badge: (name: string) => `[${name}]`,
};

describe("renderSandboxEvent", () => {
  it("prints thinking content inline with an explicit thinking label", () => {
    const rendered = renderSandboxEvent(
      createInitialReplState(),
      {
        type: "thinking",
        text: "Need to inspect the uploaded novel first.",
        agent: "screenwriter",
      },
      plainPalette,
    );

    expect(rendered.output.join("")).toContain("[screenwriter] thinking");
    expect(rendered.output.join("")).toContain("Need to inspect the uploaded novel first.");
  });

  it("prints both tool-use and tool-log phases instead of hiding non-post logs", () => {
    const afterToolUse = renderSandboxEvent(
      createInitialReplState(),
      {
        type: "tool_use",
        tool: "Read",
        id: "tool-read-1",
        input: { file_path: "测3.txt" },
        agent: "screenwriter",
      },
      plainPalette,
    );
    const afterPreLog = renderSandboxEvent(
      afterToolUse.state,
      {
        type: "tool_log",
        tool: "Read",
        phase: "pre",
        detail: { status: "running", elapsed_time_seconds: 0.5 },
        agent: "screenwriter",
      },
      plainPalette,
    );
    const afterPostLog = renderSandboxEvent(
      afterPreLog.state,
      {
        type: "tool_log",
        tool: "summary",
        phase: "post",
        detail: { summary: "Read 1 file" },
        agent: "screenwriter",
      },
      plainPalette,
    );

    expect(afterToolUse.output.join("")).toContain("Read(");
    expect(afterPreLog.output).toEqual([]);
    expect(afterPostLog.output).toEqual([]);
  });

  it("uses agent badge for text events", () => {
    const rendered = renderSandboxEvent(
      createInitialReplState(),
      { type: "text", text: "hello\n", agent: "screenwriter" },
      plainPalette,
    );
    expect(rendered.output.join("")).toContain("[screenwriter]");
  });

  it("uses [main] badge when no agent", () => {
    const rendered = renderSandboxEvent(
      createInitialReplState(),
      { type: "text", text: "hello\n" },
      plainPalette,
    );
    expect(rendered.output.join("")).toContain("[main]");
  });

  it("uses agent badge for tool_use events with bold tool name", () => {
    const rendered = renderSandboxEvent(
      createInitialReplState(),
      { type: "tool_use", tool: "Bash", id: "t1", input: { command: "ls" }, agent: "editor" },
      plainPalette,
    );
    const joined = rendered.output.join("");
    expect(joined).toContain("[editor]");
    expect(joined).toContain("Bash(ls)");
  });

  it("formats Skill tool_use with skill name", () => {
    const rendered = renderSandboxEvent(
      createInitialReplState(),
      { type: "tool_use", tool: "Skill", id: "t1", input: { skill: "commit" } },
      plainPalette,
    );
    expect(rendered.output.join("")).toContain("skill:commit");
  });

  it("renders todo list with status icons", () => {
    const rendered = renderSandboxEvent(
      createInitialReplState(),
      {
        type: "todo",
        todos: [
          { id: "1", content: "Analyze requirements", status: "completed" },
          { id: "2", content: "Write implementation", status: "in_progress" },
          { id: "3", content: "Add tests", status: "pending" },
        ],
        agent: "screenwriter",
      },
      plainPalette,
    );
    const joined = rendered.output.join("");
    expect(joined).toContain("✓ Analyze requirements");
    expect(joined).toContain("● Write implementation");
    expect(joined).toContain("○ Add tests");
    expect(rendered.state.todos).toHaveLength(3);
  });

  it("renders updated todo list replacing previous state", () => {
    const first = renderSandboxEvent(
      createInitialReplState(),
      {
        type: "todo",
        todos: [
          { id: "1", content: "Step A", status: "in_progress" },
          { id: "2", content: "Step B", status: "pending" },
        ],
      },
      plainPalette,
    );
    const second = renderSandboxEvent(
      first.state,
      {
        type: "todo",
        todos: [
          { id: "1", content: "Step A", status: "completed" },
          { id: "2", content: "Step B", status: "in_progress" },
        ],
      },
      plainPalette,
    );
    expect(second.state.todos[0].status).toBe("completed");
    expect(second.state.todos[1].status).toBe("in_progress");
  });

  it("applies markdown formatting to text stream", () => {
    const tagPalette = {
      dim: (s: string) => s,
      cyan: (s: string) => `<cyan>${s}</cyan>`,
      yellow: (s: string) => s,
      red: (s: string) => s,
      bold: (s: string) => `<bold>${s}</bold>`,
      magenta: (s: string) => `<magenta>${s}</magenta>`,
      green: (s: string) => s,
      badge: (name: string) => `[${name}]`,
    };
    const rendered = renderSandboxEvent(
      createInitialReplState(),
      { type: "text", text: "## Title\n", agent: "writer" },
      tagPalette,
    );
    expect(rendered.output.join("")).toContain("<bold>Title</bold>");
  });
});
