import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
}));

// ---------- Imports ----------

import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { extractText, fetchHistory } from "../src/session-history.js";

const mockGetSessionMessages = getSessionMessages as ReturnType<typeof vi.fn>;

// ---------- extractText ----------

describe("extractText", () => {
  it("returns raw string as-is", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("extracts content string from object", () => {
    expect(extractText({ content: "text" })).toBe("text");
  });

  it("extracts text blocks from content array", () => {
    expect(
      extractText({
        content: [
          { type: "text", text: "a" },
          { type: "tool_use", id: "x" },
        ],
      }),
    ).toBe("a");
  });

  it("returns empty string for null", () => {
    expect(extractText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(extractText(undefined)).toBe("");
  });

  it("returns empty string for number", () => {
    expect(extractText(42)).toBe("");
  });

  it("returns empty string for empty content array", () => {
    expect(extractText({ content: [] })).toBe("");
  });

  it("joins multiple text blocks with newline", () => {
    expect(
      extractText({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
  });
});

// ---------- fetchHistory ----------

describe("fetchHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns HistoryMessage[] on success", async () => {
    mockGetSessionMessages.mockResolvedValue([
      { type: "user", uuid: "u1", session_id: "s1", message: "hi", parent_tool_use_id: null },
      { type: "assistant", uuid: "u2", session_id: "s1", message: { content: "hello" }, parent_tool_use_id: null },
    ]);

    const result = await fetchHistory("s1", "/tmp", 10);
    expect(result).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(mockGetSessionMessages).toHaveBeenCalledWith("s1", { dir: "/tmp", limit: 10 });
  });

  it("returns [] when SDK throws", async () => {
    mockGetSessionMessages.mockRejectedValue(new Error("session not found"));

    const result = await fetchHistory("bad-id", "/tmp", 10);
    expect(result).toEqual([]);
  });

  it("filters out empty-content messages", async () => {
    mockGetSessionMessages.mockResolvedValue([
      { type: "user", uuid: "u1", session_id: "s1", message: "hi", parent_tool_use_id: null },
      { type: "assistant", uuid: "u2", session_id: "s1", message: null, parent_tool_use_id: null },
      { type: "assistant", uuid: "u3", session_id: "s1", message: { content: [] }, parent_tool_use_id: null },
    ]);

    const result = await fetchHistory("s1", "/tmp", 10);
    expect(result).toEqual([{ role: "user", content: "hi" }]);
  });
});
