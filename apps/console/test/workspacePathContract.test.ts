import { describe, expect, test } from "bun:test";
import {
  collectWorkspacePathViolations,
  isExpectedWorkspaceArtifactPath,
  normalizeWorkspaceRelPath,
  projectRelativePath,
  validateGeneratedWritePath,
} from "../src/lib/workspacePathContract";

describe("workspace path contract", () => {
  test("normalizes renderable workspace-relative paths", () => {
    expect(normalizeWorkspaceRelPath("/output/ep001/clip 1.mp4")).toBe("output/ep001/clip 1.mp4");
    expect(normalizeWorkspaceRelPath("output\\ep001\\clip.mp4")).toBe("output/ep001/clip.mp4");
    expect(normalizeWorkspaceRelPath("../outside.json")).toBeNull();
    expect(normalizeWorkspaceRelPath("output//bad.json")).toBeNull();
  });

  test("allows only canonical project artifact locations", () => {
    expect(isExpectedWorkspaceArtifactPath("source.txt")).toBe(true);
    expect(isExpectedWorkspaceArtifactPath("pipeline-state.json")).toBe(true);
    expect(isExpectedWorkspaceArtifactPath("input/raw.txt")).toBe(true);
    expect(isExpectedWorkspaceArtifactPath("draft/outline.json")).toBe(true);
    expect(isExpectedWorkspaceArtifactPath("output/ep001/ep001.mp4")).toBe(true);
    expect(isExpectedWorkspaceArtifactPath(".logs/run.log")).toBe(true);
    expect(isExpectedWorkspaceArtifactPath("actors/actors.json")).toBe(false);
  });

  test("keeps tool writes inside the active project and canonical folders", () => {
    const projectRoot = "/repo/workspace/p1";

    expect(projectRelativePath(projectRoot, projectRoot, "output/script.json")).toBe("output/script.json");
    expect(projectRelativePath(projectRoot, projectRoot, "/repo/workspace/p1/output/script.json")).toBe("output/script.json");
    expect(projectRelativePath(projectRoot, projectRoot, "../p2/output/script.json")).toBeNull();

    expect(validateGeneratedWritePath(projectRoot, projectRoot, "output/script.json")).toBeNull();
    expect(validateGeneratedWritePath(projectRoot, projectRoot, "actors/actors.json")).toEqual({
      path: "actors/actors.json",
      reason: "generated artifacts must live in source.txt, pipeline-state.json, input/, draft/, output/, or .logs/",
    });
  });

  test("reports path contract violations from state references", () => {
    expect(collectWorkspacePathViolations(["output/script.json", "actors/actors.json", "../x"])).toEqual([
      { path: "actors/actors.json", reason: "outside the expected project artifact layout" },
      { path: "../x", reason: "not a valid workspace-relative path" },
    ]);
  });
});
