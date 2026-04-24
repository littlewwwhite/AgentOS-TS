import { describe, expect, test } from "bun:test";
import { buildOverviewWorkbench } from "../src/lib/overviewWorkbench";
import type { PipelineState } from "../src/types";

function baseState(): PipelineState {
  return {
    version: 1,
    updated_at: "2026-04-23T10:00:00Z",
    current_stage: "STORYBOARD",
    next_action: "review STORYBOARD",
    last_error: null,
    stages: {
      INSPIRATION: { status: "approved", artifacts: ["output/inspiration.json"] },
      SCRIPT: { status: "in_review", artifacts: ["output/script.json"] },
      VISUAL: { status: "approved", artifacts: ["output/actors/actors.json"] },
      STORYBOARD: { status: "approved", artifacts: ["output/storyboard/approved/ep001_storyboard.json"] },
      VIDEO: { status: "stale", artifacts: ["output/ep001/ep001_storyboard.json"] },
      EDITING: { status: "not_started", artifacts: [] },
      MUSIC: { status: "not_started", artifacts: [] },
      SUBTITLE: { status: "not_started", artifacts: [] },
    },
    episodes: {
      ep001: {
        storyboard: { status: "approved", artifact: "output/storyboard/approved/ep001_storyboard.json" },
        video: { status: "stale" },
      },
    },
    artifacts: {
      "output/script.json": {
        kind: "canonical",
        owner_role: "writer",
        status: "in_review",
        editable: true,
        revision: 2,
        depends_on: [],
        invalidates: [],
      },
      "output/storyboard/approved/ep001_storyboard.json": {
        kind: "canonical",
        owner_role: "director",
        status: "approved",
        editable: true,
        revision: 1,
        depends_on: [],
        invalidates: ["output/ep001/ep001_storyboard.json"],
      },
    },
    change_requests: [{
      id: "cr_001",
      target_artifact: "output/storyboard/approved/ep001_storyboard.json",
      requested_by_role: "producer",
      reason: "镜头动机不清，需要返修",
      created_at: "2026-04-23T10:05:00Z",
      status: "open",
    }],
  };
}

describe("buildOverviewWorkbench", () => {
  test("builds review, change-request and stale work queues from pipeline state", () => {
    const workbench = buildOverviewWorkbench(baseState());

    expect(workbench.reviewItems).toHaveLength(1);
    expect(workbench.reviewItems[0]).toMatchObject({
      stage: "SCRIPT",
      title: "审核 SCRIPT",
      path: "output/script.json",
    });

    expect(workbench.changeRequestItems).toHaveLength(1);
    expect(workbench.changeRequestItems[0]).toMatchObject({
      stage: "STORYBOARD",
      title: "返修 STORYBOARD",
      path: "output/storyboard/approved/ep001_storyboard.json",
      reason: "镜头动机不清，需要返修",
    });

    expect(workbench.staleItems).toHaveLength(1);
    expect(workbench.staleItems[0]).toMatchObject({
      stage: "VIDEO",
      title: "重新生成 VIDEO",
      path: "output/ep001/ep001_storyboard.json",
    });
  });

  test("ignores non-legal artifacts in the review queue", () => {
    const state = baseState();
    state.artifacts!["output/ep001/ep001_delivery.json"] = {
      kind: "derived",
      owner_role: "production",
      status: "in_review",
      editable: false,
      revision: 1,
      depends_on: [],
      invalidates: [],
    };

    const workbench = buildOverviewWorkbench(state);
    expect(workbench.reviewItems.map((item) => item.path)).toEqual(["output/script.json"]);
  });
});
