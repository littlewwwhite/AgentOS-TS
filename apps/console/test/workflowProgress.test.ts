import { describe, expect, test } from "bun:test";
import { buildWorkflowProgress } from "../src/lib/workflowProgress";

describe("buildWorkflowProgress", () => {
  test("marks current, blocked, and hidden stages for the current MVP", () => {
    const items = buildWorkflowProgress({
      currentStage: "SCRIPT",
      stageStatuses: {
        SCRIPT: "in_review",
        VISUAL: "not_started",
        STORYBOARD: "not_started",
        VIDEO: "not_started",
      },
    });

    expect(items.find((item) => item.key === "SCRIPT")?.state).toBe("current");
    expect(items.find((item) => item.key === "SCRIPT")?.label).toBe("剧本");
    expect(items.some((item) => (item as { key: string }).key === "INSPIRATION")).toBe(false);
    expect(items.some((item) => item.key === "EDITING")).toBe(false);
  });
});
