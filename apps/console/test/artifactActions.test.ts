import { describe, expect, test } from "bun:test";
import type { PipelineState } from "../src/types";
import { applyArtifactActionToPipelineState } from "../src/lib/artifactActions";

function sampleState(): PipelineState {
  return {
    version: 1,
    updated_at: "2026-03-25T12:00:00Z",
    current_stage: "STORYBOARD",
    next_action: "review STORYBOARD",
    last_error: null,
    stages: {
      SCRIPT: { status: "in_review", artifacts: ["output/script.json"], owner_role: "writer", revision: 2, locked: false },
      STORYBOARD: { status: "completed", artifacts: ["output/storyboard/draft/ep001_storyboard.json"], owner_role: "director", revision: 1, locked: false },
      VIDEO: { status: "not_started", artifacts: [] },
    },
    episodes: {
      ep001: {
        storyboard: { status: "in_review", artifact: "output/storyboard/draft/ep001_storyboard.json" },
        video: { status: "not_started" },
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
        invalidates: ["output/storyboard/draft/ep001_storyboard.json"],
        updated_at: "2026-03-25T12:00:00Z",
        notes: null,
      },
      "output/storyboard/draft/ep001_storyboard.json": {
        kind: "source",
        owner_role: "director",
        status: "in_review",
        editable: true,
        revision: 1,
        depends_on: ["output/script.json"],
        invalidates: [],
        updated_at: "2026-03-25T12:00:00Z",
        notes: null,
      },
    },
    change_requests: [],
  };
}

describe("applyArtifactActionToPipelineState", () => {
  test("approves a legal storyboard artifact and updates its episode state", () => {
    const next = applyArtifactActionToPipelineState(
      sampleState(),
      "output/storyboard/draft/ep001_storyboard.json",
      { action: "approve" },
      "2026-03-25T12:10:00Z",
    );

    expect(next.updated_at).toBe("2026-03-25T12:10:00Z");
    expect(next.stages.STORYBOARD?.status).toBe("approved");
    expect(next.artifacts?.["output/storyboard/draft/ep001_storyboard.json"]?.status).toBe("approved");
    expect(next.artifacts?.["output/storyboard/draft/ep001_storyboard.json"]?.editable).toBe(true);
    expect(next.artifacts?.["output/storyboard/approved/ep001_storyboard.json"]?.status).toBe("approved");
    expect(next.episodes.ep001?.storyboard?.status).toBe("approved");
    expect(next.episodes.ep001?.storyboard?.artifact).toBe("output/storyboard/approved/ep001_storyboard.json");
    expect(next.next_action).toBe("enter VIDEO");
  });

  test("locks an approved artifact without creating a new revision", () => {
    const next = applyArtifactActionToPipelineState(
      sampleState(),
      "output/script.json",
      { action: "lock" },
      "2026-03-25T12:20:00Z",
    );

    expect(next.stages.SCRIPT?.status).toBe("locked");
    expect(next.stages.SCRIPT?.locked).toBe(true);
    expect(next.artifacts?.["output/script.json"]?.status).toBe("locked");
    expect(next.artifacts?.["output/script.json"]?.editable).toBe(false);
    expect(next.artifacts?.["output/script.json"]?.revision).toBe(2);
  });

  test("records a change request against the target artifact", () => {
    const next = applyArtifactActionToPipelineState(
      sampleState(),
      "output/script.json",
      {
        action: "request_change",
        reason: "导演认为第 1 集动机不成立",
        requestedByRole: "director",
      },
      "2026-03-25T12:30:00Z",
    );

    expect(next.current_stage).toBe("SCRIPT");
    expect(next.next_action).toBe("revise SCRIPT");
    expect(next.stages.SCRIPT?.status).toBe("change_requested");
    expect(next.artifacts?.["output/script.json"]?.status).toBe("change_requested");
    expect(next.artifacts?.["output/script.json"]?.editable).toBe(true);
    expect(next.change_requests).toHaveLength(1);
    expect(next.change_requests?.[0]).toMatchObject({
      id: "cr_20260325T123000Z_output_script_json",
      target_artifact: "output/script.json",
      requested_by_role: "director",
      reason: "导演认为第 1 集动机不成立",
      status: "open",
    });
  });

  test("rejects actions on non-business artifacts", () => {
    expect(() =>
      applyArtifactActionToPipelineState(
        sampleState(),
        "output/ep001/ep001_delivery.json",
        { action: "approve" },
        "2026-03-25T12:40:00Z",
      ),
    ).toThrow("not a legal business artifact");
  });
});
