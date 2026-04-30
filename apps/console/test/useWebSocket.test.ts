import { describe, expect, test } from "bun:test";
import { systemStatusMessage } from "../src/hooks/useWebSocket";

describe("websocket system status", () => {
  test("surfaces Claude API retry events as readable chat status", () => {
    expect(systemStatusMessage("api_retry", {
      attempt: 5,
      max_retries: 10,
      error_status: 503,
      error: "server_error",
    })).toBe("模型服务暂时不可用（503 server_error），正在重试 5/10");
  });

  test("keeps unrelated system events out of the transcript", () => {
    expect(systemStatusMessage("hook_started", { hook_name: "SessionStart" })).toBeNull();
  });
});
