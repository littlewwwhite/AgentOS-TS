import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildServerVerifiedAgentMessage,
  buildServerVerifiedProjectSnapshot,
} from "../src/lib/agentProjectSnapshot";

const FIX = "/tmp/console-agent-project-snapshot";

function setupProject() {
  rmSync(FIX, { recursive: true, force: true });
  mkdirSync(join(FIX, "output", "ep001", "scn001"), { recursive: true });
  writeFileSync(
    join(FIX, "pipeline-state.json"),
    JSON.stringify({
      current_stage: "VIDEO",
      next_action: "retry VIDEO",
      stages: {
        SCRIPT: { status: "validated", artifacts: ["output/script.json"] },
        VIDEO: { status: "failed", artifacts: ["output/ep001/missing_delivery.json"] },
      },
      episodes: {
        ep001: { video: { status: "failed", generated: 0, failed: 6 } },
      },
      last_error: "poll timeout",
    }),
  );
  writeFileSync(join(FIX, "output", "ep001", "scn001", "clip001.mp4"), "fake");
}

describe("buildServerVerifiedAgentMessage", () => {
  test("builds an authoritative project snapshot without rewriting the user request", () => {
    setupProject();

    const snapshot = buildServerVerifiedProjectSnapshot({ projectRoot: FIX });

    expect(snapshot).not.toBeNull();
    expect(snapshot).toContain("[Server-Verified Project Snapshot]");
    expect(snapshot).toContain("\"current_stage\": \"VIDEO\"");
    expect(snapshot).toContain("\"next_action\": \"retry VIDEO\"");
    expect(snapshot).toContain("Playable video files: 1");
    expect(snapshot).not.toContain("[User Request]");
  });

  test("injects authoritative pipeline state and artifact evidence before the user request", () => {
    setupProject();

    const message = buildServerVerifiedAgentMessage({
      projectRoot: FIX,
      userMessage: "查询现在的进度",
    });

    expect(message).toContain("[Server-Verified Project Snapshot]");
    expect(message).toContain("\"current_stage\": \"VIDEO\"");
    expect(message).toContain("\"next_action\": \"retry VIDEO\"");
    expect(message).toContain("\"status\": \"failed\"");
    expect(message).toContain("Playable video files: 1");
    expect(message).toContain("output/ep001/scn001/clip001.mp4");
    expect(message).toContain("Missing referenced artifacts:");
    expect(message).toContain("output/script.json");
    expect(message).toContain("output/ep001/missing_delivery.json");
    expect(message).toContain("Never ask the user to paste pipeline-state.json");
    expect(message).toContain("[User Request]\n查询现在的进度");
  });

  test("keeps the original message when no project root is available", () => {
    const message = buildServerVerifiedAgentMessage({
      projectRoot: null,
      userMessage: "你好",
    });

    expect(message).toBe("你好");
  });
});
