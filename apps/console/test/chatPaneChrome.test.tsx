import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPane } from "../src/components/Chat/ChatPane";

describe("ChatPane chrome", () => {
  test("renders workflow-aligned suggestions instead of hard-coded post-production prompts", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: false,
        onSend: () => undefined,
        messages: [],
        suggestions: ["帮我审核当前 SCRIPT 产物", "打开待审核入口", "继续下一步"],
      }),
    );

    expect(html).toContain("帮我审核当前 SCRIPT 产物");
    expect(html).not.toContain("视频剪辑");
  });

  test("keeps the input available while the agent is streaming", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: true,
        onSend: () => undefined,
        messages: [],
        suggestions: [],
      }),
    );

    expect(html).toContain("输入消息，或输入 / 调用 Claude Code 命令…");
    expect(html).not.toMatch(/<textarea[^>]*\sdisabled(?:=|\s|>)/);
  });

  test("renders thinking messages as visible transcript content", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: true,
        onSend: () => undefined,
        messages: [
          {
            id: "thinking-1",
            role: "assistant",
            kind: "thinking",
            content: "需要先读取 pipeline-state.json。",
            isStreaming: true,
            timestamp: 1,
          },
        ],
        suggestions: [],
      }),
    );

    expect(html).toContain("thinking");
    expect(html).toContain("需要先读取 pipeline-state.json。");
  });

  test("renders a pause control while the agent is streaming", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: true,
        onSend: () => undefined,
        onStop: () => undefined,
        messages: [],
        suggestions: [],
      }),
    );

    expect(html).toContain('aria-label="暂停生成"');
    expect(html).toContain("⏸");
  });

  test("uses distinct chat surfaces for user and assistant messages", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: false,
        onSend: () => undefined,
        messages: [
          { id: "u1", role: "user", content: "继续", timestamp: 1 },
          { id: "a1", role: "assistant", content: "下一步审核 source.txt", timestamp: 2 },
        ],
        suggestions: [],
      }),
    );

    expect(html).toContain("bg-[var(--color-chat-user)]");
    expect(html).toContain("bg-[var(--color-chat-assistant)]");
  });

  test("renders active production scope above the transcript", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: false,
        onSend: () => undefined,
        messages: [],
        suggestions: [],
        productionObject: {
          type: "shot",
          episodeId: "ep001",
          sceneId: "scn002",
          shotId: "clip003",
          path: "output/ep001/scn002/clip003/v1.mp4",
        },
      }),
    );

    expect(html).toContain("Current scope");
    expect(html).toContain("ep001 · scn002 · clip003");
    expect(html).toContain("current shot");
  });
});
