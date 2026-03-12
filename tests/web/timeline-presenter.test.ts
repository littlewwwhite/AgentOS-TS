import { describe, expect, it } from "vitest";
import {
  getTimelineCardTone,
  getTimelineTitle,
} from "../../web/lib/timeline-presenter";
import type { TimelineItem } from "../../web/lib/reduce-sandbox-event";

describe("timeline-presenter", () => {
  it("describes thinking and tool items with specific labels", () => {
    const thinking: TimelineItem = {
      kind: "thinking",
      id: "thinking-1",
      text: "Inspecting dependencies",
      streaming: false,
    };
    const toolUse: TimelineItem = {
      kind: "tool_use",
      id: "tool-1",
      tool: "write_file",
      toolCallId: "call-1",
    };

    expect(getTimelineTitle(thinking)).toBe("Thinking");
    expect(getTimelineTitle(toolUse)).toBe("Tool Call");
  });

  it("marks failures and active work with different tones", () => {
    const result: TimelineItem = {
      kind: "result",
      id: "result-1",
      cost: 0.2,
      durationMs: 500,
      isError: true,
    };
    const toolLog: TimelineItem = {
      kind: "tool_log",
      id: "log-1",
      tool: "write_file",
      phase: "pre",
      detail: { path: "/workspace/a.ts" },
    };

    expect(getTimelineCardTone(result)).toBe("error");
    expect(getTimelineCardTone(toolLog)).toBe("active");
  });
});
