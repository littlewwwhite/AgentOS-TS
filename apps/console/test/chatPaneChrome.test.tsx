import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, * as ReactModule from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPane } from "../src/components/Chat/ChatPane";

function findElementByType(node: unknown, type: string): any {
  if (!node || typeof node !== "object") return null;

  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.type === type) return element;

  const children = element.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const match = findElementByType(child, type);
      if (match) return match;
    }
    return null;
  }

  return findElementByType(children, type);
}

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

    expect(html).toContain("说出要调整的镜头、分镜、素材或下一步…");
    expect(html).toContain("aria-label=\"聊天输入\"");
    expect(html).not.toContain("导演指令");
    expect(html).not.toContain("输入 / 技能");
    expect(html).not.toContain("输入消息，或输入 / 调用 Claude Code 命令…");
    expect(html).not.toContain("输入 / 调用制作技能");
    expect(html).not.toContain("shadow-[0_10px_30px");
    expect(html).not.toContain("mb-2 flex items-center justify-between");
    expect(html).not.toMatch(/<textarea[^>]*\sdisabled(?:=|\s|>)/);
  });

  test("surfaces elapsed thinking time while waiting for a reply", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: true,
        onSend: () => undefined,
        messages: [{ id: "u1", role: "user", content: "你是谁", timestamp: 1 }],
        suggestions: [],
      }),
    );

    expect(html).toContain("正在思考");
    expect(html).toContain("1s");
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

  test("renders assistant markdown instead of plain markdown text", () => {
    const html = renderToStaticMarkup(
      React.createElement(ChatPane, {
        isConnected: true,
        isStreaming: false,
        onSend: () => undefined,
        messages: [
          {
            id: "a1",
            role: "assistant",
            content: "## 下一步\n\n- **校对**提示词\n- 运行 `/video-gen`\n\n```ts\nconst ok = true;\n```",
            timestamp: 2,
          },
        ],
        suggestions: [],
      }),
    );

    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
    expect(html).toContain("<strong");
    expect(html).toContain("<code");
    expect(html).not.toContain("## 下一步");
    expect(html).not.toContain("- **校对**提示词");
    expect(html).not.toContain("```ts");
  });

  test("submits the original composer input so transcript whitespace stays intact", () => {
    const onSend = mock(() => undefined);
    const rawInput = " /storyboard ep001 ";
    const actualReact = { ...ReactModule };

    mock.module("react", () => ({
      ...actualReact,
      useEffect: () => undefined,
      useRef: () => ({ current: null }),
      useState<T>(initialState: T | (() => T)) {
        const value =
          typeof initialState === "string"
            ? (rawInput as unknown as T)
            : typeof initialState === "function"
              ? (initialState as () => T)()
              : initialState;
        return [value, () => undefined] as const;
      },
    }));

    try {
      const tree = ChatPane({
        isConnected: true,
        isStreaming: false,
        onSend,
        messages: [],
        suggestions: [],
      });

      const form = findElementByType(tree, "form");
      expect(form).not.toBeNull();
      form.props.onSubmit({ preventDefault() {} });

      expect(onSend).toHaveBeenCalledTimes(1);
      expect(onSend).toHaveBeenCalledWith(rawInput);
    } finally {
      mock.module("react", () => actualReact);
    }
  });


  test("renders skill descriptions in slash command options", () => {
    const actualReact = { ...ReactModule };

    mock.module("react", () => ({
      ...actualReact,
      useEffect: () => undefined,
      useRef: () => ({ current: null }),
      useState<T>(initialState: T | (() => T)) {
        const value = typeof initialState === "string"
          ? ("/s" as unknown as T)
          : typeof initialState === "function"
            ? (initialState as () => T)()
            : initialState;
        return [value, () => undefined] as const;
      },
    }));

    try {
      const html = renderToStaticMarkup(
        React.createElement(ChatPane, {
          isConnected: true,
          isStreaming: false,
          onSend: () => undefined,
          messages: [],
          suggestions: [],
          slashCommands: ["/storyboard", "/script-writer"],
        }),
      );

      expect(html).toContain("/storyboard");
      expect(html).toContain("根据剧本和视觉设定生成视频前故事板");
      expect(html).toContain("/script-writer");
      expect(html).toContain("从故事源扩写正式剧本");
      expect(html).not.toContain("高级命令");
    } finally {
      mock.module("react", () => actualReact);
    }
  });

  test("renders active production scope as a compact command target", () => {
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

    expect(html).toContain("指令对象");
    expect(html).toContain("ep001 · scn002 · clip003");
    expect(html).not.toContain("当前指令对象");
    expect(html).not.toContain("默认只改当前镜头");
    expect(html).not.toContain("不改剧本、分镜定稿和登记素材");
    expect(html).not.toContain("Current scope");
    expect(html).not.toContain("current shot");
    expect(html).not.toContain("selected file");
  });
});
