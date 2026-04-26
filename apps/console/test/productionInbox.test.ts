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
      STORYBOARD: { status: "approved", artifacts: ["output/storyboard/approved/ep001_storyboard.json"] },
      VIDEO: { status: "approved", artifacts: ["output/ep001/ep001_delivery.json"] },
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
        invalidates: ["output/storyboard/approved/ep001_storyboard.json"],
      },
      "output/storyboard/approved/ep001_storyboard.json": {
        kind: "canonical",
        owner_role: "director",
        status: "approved",
        editable: true,
        revision: 2,
        depends_on: ["output/script.json"],
        invalidates: ["output/ep001/ep001_delivery.json"],
      },
    },
    change_requests: [],
  };
}

describe("buildProductionInbox", () => {
  test("maps review items to decision priority and approval CTA", () => {
    const nextState = state();
    nextState.artifacts!["output/storyboard/approved/ep001_storyboard.json"] = {
      ...nextState.artifacts!["output/storyboard/approved/ep001_storyboard.json"],
      status: "in_review",
    };

    const inbox = buildProductionInbox(nextState);

    expect(inbox.primaryItems).toHaveLength(1);
    expect(inbox.primaryItems[0]).toMatchObject({
      kind: "review",
      priority: "decision",
      cta: "去拍板",
      title: "审核 STORYBOARD",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
  });

  test("maps change requests to blocked priority and revise CTA", () => {
    const nextState = state();
    nextState.change_requests = [
      {
        id: "cr_001",
        target_artifact: "output/storyboard/approved/ep001_storyboard.json",
        requested_by_role: "producer",
        reason: "镜头节奏过慢",
        created_at: "2026-04-26T00:01:00Z",
        status: "open",
      },
    ];

    const inbox = buildProductionInbox(nextState);

    expect(inbox.primaryItems).toHaveLength(1);
    expect(inbox.primaryItems[0]).toMatchObject({
      kind: "change_request",
      priority: "blocked",
      cta: "去返修",
      title: "返修 STORYBOARD",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
  });

  test("maps stale stages to blocked priority and regenerate CTA", () => {
    const nextState = state();
    nextState.stages.STORYBOARD = {
      ...nextState.stages.STORYBOARD,
      status: "stale",
    };

    const inbox = buildProductionInbox(nextState);

    expect(inbox.primaryItems).toHaveLength(1);
    expect(inbox.primaryItems[0]).toMatchObject({
      kind: "stale",
      priority: "blocked",
      cta: "重新生成",
      title: "重新生成 STORYBOARD",
      path: "output/storyboard/approved/ep001_storyboard.json",
    });
  });

  test("sorts mixed queues by priority, stage order, and key", () => {
    const nextState = state();
    nextState.stages.SCRIPT = {
      ...nextState.stages.SCRIPT,
      status: "stale",
    };
    nextState.stages.STORYBOARD = {
      ...nextState.stages.STORYBOARD,
      status: "stale",
    };
    nextState.artifacts!["output/script.json"] = {
      ...nextState.artifacts!["output/script.json"],
      status: "in_review",
    };
    nextState.change_requests = [
      {
        id: "cr_010",
        target_artifact: "output/storyboard/approved/ep010_storyboard.json",
        requested_by_role: "producer",
        reason: "late-stage fix",
        created_at: "2026-04-26T00:03:00Z",
        status: "open",
      },
      {
        id: "cr_002",
        target_artifact: "output/storyboard/approved/ep001_storyboard.json",
        requested_by_role: "producer",
        reason: "current shot needs revision",
        created_at: "2026-04-26T00:02:00Z",
        status: "open",
      },
      {
        id: "cr_001",
        target_artifact: "output/ep001/ep001_delivery.json",
        requested_by_role: "director",
        reason: "regenerate delivery",
        created_at: "2026-04-26T00:01:00Z",
        status: "open",
      },
    ];

    const inbox = buildProductionInbox(nextState);

    expect(inbox.primaryItems.map((item) => item.key)).toEqual([
      "stale:SCRIPT",
      "cr_002",
      "cr_010",
      "stale:STORYBOARD",
      "cr_001",
      "review:output/script.json",
    ]);
    expect(inbox.primaryItems.map((item) => item.priority)).toEqual([
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "decision",
    ]);
  });

  test("keeps summary counts aligned with primary items", () => {
    const nextState = state();
    nextState.stages.SCRIPT = {
      ...nextState.stages.SCRIPT,
      status: "stale",
    };
    nextState.artifacts!["output/storyboard/approved/ep001_storyboard.json"] = {
      ...nextState.artifacts!["output/storyboard/approved/ep001_storyboard.json"],
      status: "in_review",
    };
    nextState.change_requests = [
      {
        id: "cr_001",
        target_artifact: "output/storyboard/approved/ep001_storyboard.json",
        requested_by_role: "producer",
        reason: "镜头节奏过慢",
        created_at: "2026-04-26T00:01:00Z",
        status: "open",
      },
    ];

    const inbox = buildProductionInbox(nextState);
    const decisions = inbox.primaryItems.filter((item) => item.priority === "decision").length;
    const blocked = inbox.primaryItems.filter((item) => item.priority === "blocked").length;

    expect(inbox.summary).toEqual({
      decisions,
      blocked,
      total: inbox.primaryItems.length,
    });
  });
});
