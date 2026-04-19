import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../src/types";
import {
  buildChatHistoryKey,
  parseStoredChatMessages,
  readStoredChatMessages,
  resolveRestoredChatMessages,
  sanitizeChatMessages,
  writeStoredChatMessages,
} from "../src/lib/chatHistory";

describe("chat history helpers", () => {
  test("builds a storage key from project and session id", () => {
    expect(buildChatHistoryKey("c3", "sess_123")).toBe("agentos:chat:c3:sess_123");
  });

  test("sanitizes restored messages by clearing streaming flags", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "assistant", content: "hi", isStreaming: true, timestamp: 1 },
    ];
    expect(sanitizeChatMessages(messages)).toEqual([
      { id: "1", role: "assistant", content: "hi", isStreaming: false, timestamp: 1 },
    ]);
  });

  test("parses stored messages and drops invalid payloads", () => {
    const raw = JSON.stringify([
      { id: "1", role: "user", content: "hello", timestamp: 1 },
      { nope: true },
    ]);
    expect(parseStoredChatMessages(raw)).toEqual([
      { id: "1", role: "user", content: "hello", timestamp: 1, isStreaming: false },
    ]);
    expect(parseStoredChatMessages("not json")).toEqual([]);
  });

  test("writes and reads chat history by project + session id", () => {
    const store = new Map<string, string>();
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => { store.set(key, value); },
          removeItem: (key: string) => { store.delete(key); },
        },
      },
    });

    try {
      writeStoredChatMessages("c3", "sess_123", [
        { id: "1", role: "assistant", content: "已保存", isStreaming: true, timestamp: 1 },
      ]);

      expect(store.get(buildChatHistoryKey("c3", "sess_123"))).toContain("\"isStreaming\":false");
      expect(readStoredChatMessages("c3", "sess_123")).toEqual([
        { id: "1", role: "assistant", content: "已保存", isStreaming: false, timestamp: 1 },
      ]);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  test("keeps current draft messages while first session id is being assigned", () => {
    const draft: ChatMessage[] = [
      { id: "u1", role: "user", content: "继续", timestamp: 1 },
    ];
    expect(
      resolveRestoredChatMessages(draft, [], {
        sameKey: false,
        projectChanged: false,
        sessionChanged: true,
        bootstrappingSession: true,
      }),
    ).toEqual(draft);
  });

  test("clears old messages when same project switches to a different session without history", () => {
    const previous: ChatMessage[] = [
      { id: "a1", role: "assistant", content: "上一轮", timestamp: 1 },
    ];
    expect(
      resolveRestoredChatMessages(previous, [], {
        sameKey: false,
        projectChanged: false,
        sessionChanged: true,
        bootstrappingSession: false,
      }),
    ).toEqual([]);
  });
});
