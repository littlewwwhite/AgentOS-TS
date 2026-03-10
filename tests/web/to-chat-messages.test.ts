import { describe, expect, it } from "vitest";
import { toChatMessages } from "../../web/lib/to-chat-messages";
import type { TimelineItem } from "../../web/lib/reduce-sandbox-event";

describe("toChatMessages", () => {
  it("keeps only user and assistant transcript items in order", () => {
    const timeline: TimelineItem[] = [
      { kind: "system", id: "sys-1", text: "Entered agent: screenwriter" },
      { kind: "user", id: "user-1", text: "Write a teaser", createdAt: 100 },
      { kind: "tool_use", id: "tool-1", tool: "write_file", toolCallId: "call-1" },
      { kind: "assistant", id: "assistant-1", text: "Here is a teaser.", streaming: false },
      { kind: "result", id: "result-1", cost: 0.2, durationMs: 800, isError: false },
    ];

    expect(toChatMessages(timeline)).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Write a teaser" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Here is a teaser." }],
      },
    ]);
  });

  it("returns an empty array when there is no transcript content", () => {
    const timeline: TimelineItem[] = [
      { kind: "tool_use", id: "tool-1", tool: "bash", toolCallId: "call-1" },
      { kind: "result", id: "result-1", cost: 0.2, durationMs: 400, isError: false },
    ];

    expect(toChatMessages(timeline)).toEqual([]);
  });
});
