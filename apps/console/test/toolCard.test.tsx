import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPane } from "../src/components/Chat/ChatPane";
import { ToolCard } from "../src/components/Chat/ToolCard";

describe("ToolCard", () => {
  test("renders collapsed tool_use cards in a compact summary layout", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolCard, {
        message: {
          id: "tool-1",
          role: "assistant",
          content: "",
          toolName: "Read",
          toolInput: { file_path: "workspace/c3/output/script.json" },
          toolOutput: "summary",
          timestamp: Date.UTC(2026, 3, 20, 12, 30),
        },
      }),
    );

    expect(html).toContain("gap-0.5");
    expect(html).toContain("pt-1.5");
    expect(html).toContain("grid-cols-[14px_minmax(0,1fr)_auto]");
    expect(html).toContain("min-h-9");
    expect(html).toContain("[展开]");
  });

  test("summarizes tool paths without repeating full workspace paths", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolCard, {
        message: {
          id: "tool-1",
          role: "assistant",
          content: "",
          toolName: "Read",
          toolInput: { file_path: "workspace/c3/output/script.json" },
          toolOutput: "workspace/c3/output/script.json",
          timestamp: Date.UTC(2026, 3, 20, 12, 30),
        },
      }),
    );

    expect(html).toContain("script.json");
    expect(html).not.toContain("workspace/c3/output/script.json");
  });

  test("chat stream uses tighter spacing so tool rows do not drift apart", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: false,
        onSend: () => undefined,
        messages: [
          {
            id: "tool-1",
            role: "assistant",
            content: "",
            toolName: "Read",
            toolInput: { file_path: "workspace/c3/output/script.json" },
            toolOutput: "summary",
            timestamp: 1,
          },
          {
            id: "tool-2",
            role: "assistant",
            content: "",
            toolName: "Write",
            toolInput: { file_path: "workspace/c3/output/script.json" },
            timestamp: 2,
          },
        ],
      }),
    );

    expect(html).toContain("gap-3");
    expect(html).not.toContain("gap-6");
  });
});
