import { describe, expect, test } from "bun:test";
import { resolveWsUrl } from "../src/lib/wsUrl";

describe("websocket url", () => {
  test("uses secure websocket on https origins", () => {
    expect(resolveWsUrl("https:", "console.example.com")).toBe("wss://console.example.com/ws");
  });

  test("routes Vite local dev websocket traffic to the Bun backend", () => {
    expect(resolveWsUrl("http:", "localhost:5173")).toBe("ws://localhost:3001/ws");
    expect(resolveWsUrl("http:", "127.0.0.1:5173")).toBe("ws://127.0.0.1:3001/ws");
  });

  test("uses same-origin websocket outside Vite local dev", () => {
    expect(resolveWsUrl("http:", "localhost:3001")).toBe("ws://localhost:3001/ws");
  });
});
