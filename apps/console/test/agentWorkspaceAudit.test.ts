import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  auditProjectWorkspaceAfterTool,
  snapshotProjectFiles,
} from "../src/lib/agentWorkspaceAudit";

const FIX = "/tmp/console-agent-workspace-audit";

function setupProject() {
  rmSync(FIX, { recursive: true, force: true });
  mkdirSync(join(FIX, "output"), { recursive: true });
  writeFileSync(
    join(FIX, "pipeline-state.json"),
    JSON.stringify({
      version: 1,
      current_stage: "VIDEO",
      next_action: "generate VIDEO",
      last_error: null,
      stages: { VIDEO: { status: "running", artifacts: [] } },
      episodes: {},
    }),
  );
}

describe("agent workspace audit", () => {
  test("marks pipeline failed when a tool creates non-contract project files", () => {
    setupProject();
    const before = snapshotProjectFiles(FIX);

    mkdirSync(join(FIX, "actors"), { recursive: true });
    writeFileSync(join(FIX, "actors", "actors.json"), "{}");
    writeFileSync(join(FIX, "output", "script.json"), "{}");

    const result = auditProjectWorkspaceAfterTool({
      projectRoot: FIX,
      before,
      toolName: "Bash",
    });

    expect(result.violations).toEqual([
      { path: "actors/actors.json", reason: "outside the expected project artifact layout" },
    ]);
    expect(result.message).toContain("actors/actors.json");

    const state = JSON.parse(readFileSync(join(FIX, "pipeline-state.json"), "utf-8"));
    expect(state.current_stage).toBe("VIDEO");
    expect(state.last_error).toContain("Path contract violation after Bash");
    expect(state.stages.VIDEO.status).toBe("failed");
  });

  test("passes when a tool only creates output artifacts", () => {
    setupProject();
    const before = snapshotProjectFiles(FIX);

    mkdirSync(join(FIX, "output", "ep001"), { recursive: true });
    writeFileSync(join(FIX, "output", "ep001", "clip.mp4"), "fake");

    const result = auditProjectWorkspaceAfterTool({
      projectRoot: FIX,
      before,
      toolName: "Bash",
    });

    expect(result.violations).toEqual([]);
    expect(result.message).toBeNull();
  });
});
