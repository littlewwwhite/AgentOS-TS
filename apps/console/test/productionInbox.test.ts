import { describe, expect, test } from "bun:test";
import { buildProductionInbox } from "../src/lib/productionInbox";
import type { PipelineState } from "../src/types";

function state(): PipelineState {
  return {
    version: 1,
    updated_at: "2026-04-26T00:00:00Z",
    current_stage: "VIDEO",
    next_action: "review VIDEO",
    last_error: null,
    stages: {
      SCRIPT: { status: "approved", artifacts: ["output/script.json"] },
      VISUAL: { status: "approved", artifacts: ["output/actors/actors.json"] },
      STORYBOARD: { status: "stale", artifacts: ["output/storyboard/approved/ep001_storyboard.json"] },
      VIDEO: { status: "in_review", artifacts: ["output/ep001/ep001_delivery.json"] },
      EDITING: { status: "not_started", artifacts: [] },
      MUSIC: { status: "not_started", artifacts: [] },
      SUBTITLE: { status: "not_started", artifacts: [] },
    },
    episodes: {},
    artifacts: {
      "output/script.json": {
        kind: "canonical",
        owner_role: "writer",
        status: "approved",
        editable: true,
        revision: 1,
        depends_on: [],
        invalidates: [],
      },
      "output/storyboard/approved/ep001_storyboard.json": {
        kind: "canonical",
        owner_role: "director",
        status: "change_requested",
        editable: true,
        revision: 2,
        depends_on: ["output/script.json"],
        invalidates: ["output/ep001/ep001_delivery.json"],
      },
    },
    change_requests: [
      {
        id: "cr_001",
        target_artifact: "output/storyboard/approved/ep001_storyboard.json",
        requested_by_role: "producer",
        reason: "镜头节奏过慢",
        created_at: "2026-04-26T00:01:00Z",
        status: "open",
      },
    ],
  };
}

describe("buildProductionInbox", () => {
  test("places decision and blocker items before passive status", () => {
    const inbox = buildProductionInbox(state());

    expect(inbox.primaryItems).toHaveLength(2);
    expect(inbox.primaryItems[0]).toMatchObject({
      priority: "blocked",
      title: "返修 STORYBOARD",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
    expect(inbox.primaryItems[1]).toMatchObject({
      priority: "blocked",
      title: "重新生成 STORYBOARD",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
    expect(inbox.summary).toEqual({ decisions: 0, blocked: 2, total: 2 });
  });
});
