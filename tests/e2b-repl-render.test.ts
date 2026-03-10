import { describe, expect, it } from "vitest";

import { renderSandboxEvent } from "../src/e2b-repl-render.js";
import { createInitialReplState } from "../src/e2b-repl-state.js";

const plainPalette = {
  dim: (text: string) => text,
  cyan: (text: string) => text,
  yellow: (text: string) => text,
  red: (text: string) => text,
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

    expect(rendered.output.join("")).toContain("[screenwriter thinking] ");
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
    expect(afterPreLog.output.join("")).toContain("running");
    expect(afterPostLog.output.join("")).toContain("Read 1 file");
  });
});
