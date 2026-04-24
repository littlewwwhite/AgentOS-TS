import { describe, expect, test } from "bun:test";
import { buildWorkflowStatus } from "../src/lib/workflowStatus";
import type { PipelineState } from "../src/types";

function baseState(): PipelineState {
  return {
    version: 1,
    updated_at: "2026-04-23T10:00:00Z",
    current_stage: "SCRIPT",
    next_action: "review SCRIPT",
    last_error: null,
    stages: {
      SCRIPT: { status: "in_review", artifacts: ["output/script.json"] },
      STORYBOARD: { status: "not_started", artifacts: [] },
      VIDEO: { status: "not_started", artifacts: [] },
    },
    episodes: {},
    artifacts: {
      "output/script.json": {
        kind: "canonical",
        owner_role: "writer",
        status: "in_review",
        editable: true,
        revision: 1,
        depends_on: [],
        invalidates: [],
      },
    },
    change_requests: [],
  };
}

describe("buildWorkflowStatus", () => {
  test("explains that review work blocks downstream progress", () => {
    const status = buildWorkflowStatus(baseState());

    expect(status.tone).toBe("review");
    expect(status.currentStage).toBe("SCRIPT");
    expect(status.nextStep).toContain("审核");
    expect(status.counts.review).toBe(1);
  });

  test("surfaces errors before normal next-step guidance", () => {
    const state = baseState();
    state.last_error = "video provider timeout";

    const status = buildWorkflowStatus(state);

    expect(status.tone).toBe("error");
    expect(status.title).toContain("异常");
    expect(status.nextStep).toContain("错误");
  });
});
