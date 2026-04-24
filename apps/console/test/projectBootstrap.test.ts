import { describe, expect, test } from "bun:test";
import { buildProjectBootstrap } from "../src/lib/projectBootstrap";

describe("buildProjectBootstrap", () => {
  test("creates minimal workspace skeleton for a new script project", () => {
    const plan = buildProjectBootstrap({
      projectName: "新项目 A",
      sourceFilename: "novel.md",
      sourceContentType: "text/markdown",
      now: "2026-04-23T12:00:00Z",
    });

    expect(plan.projectKey).toBe("新项目 A");
    expect(plan.files.map((file) => file.path)).toEqual([
      "input/novel.md",
      "source.txt",
      "pipeline-state.json",
    ]);
    expect(plan.sourceUpdated).toBe(true);
    expect(plan.initialState.current_stage).toBe("SCRIPT");
    expect(plan.initialState.next_action).toBe("review SCRIPT");
    expect(plan.initialState.artifacts?.["source.txt"]).toMatchObject({
      kind: "source",
      owner_role: "writer",
      status: "in_review",
    });
  });

  test("keeps non-text sources in input without pretending script flow can continue", () => {
    const plan = buildProjectBootstrap({
      projectName: "项目-docx",
      sourceFilename: "story.docx",
      sourceContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      now: "2026-04-23T12:00:00Z",
    });

    expect(plan.files.map((file) => file.path)).toEqual([
      "input/story.docx",
      "pipeline-state.json",
    ]);
    expect(plan.sourceUpdated).toBe(false);
    expect(plan.initialState.current_stage).toBe("SCRIPT");
    expect(plan.initialState.next_action).toBe("prepare source SCRIPT");
    expect(plan.initialState.artifacts ?? {}).not.toHaveProperty("source.txt");
  });
});
