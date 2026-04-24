import { describe, expect, test } from "bun:test";
import type { PipelineState } from "../src/types";
import { applyManualEditToPipelineState, getEditPolicy } from "../src/lib/editPolicy";

describe("getEditPolicy", () => {
  test("allows legal business edit points", () => {
    expect(getEditPolicy("source.txt")?.artifactKind).toBe("source");
    expect(getEditPolicy("draft/design.json")?.stage).toBe("SCRIPT");
    expect(getEditPolicy("draft/catalog.json")?.stage).toBe("SCRIPT");
    expect(getEditPolicy("draft/episodes/ep001.md")?.contentKind).toBe("text");
    expect(getEditPolicy("output/script.json")?.artifactKind).toBe("canonical");
    expect(getEditPolicy("output/storyboard/draft/ep001_storyboard.json")?.episodeId).toBe("ep001");
    expect(getEditPolicy("output/storyboard/approved/ep001_storyboard.json")?.episodeId).toBe("ep001");
  });

  test("rejects derived and unknown artifacts", () => {
    expect(getEditPolicy("output/ep001/ep001_storyboard.json")).toBeNull();
    expect(getEditPolicy("output/ep001/ep001_delivery.json")).toBeNull();
    expect(getEditPolicy("output/ep001/scn001/clip001/v1.mp4")).toBeNull();
    expect(getEditPolicy("output/inspiration.json")).toBeNull();
    expect(getEditPolicy("output/random.json")).toBeNull();
  });
});

describe("applyManualEditToPipelineState", () => {
  function sampleState(): PipelineState {
    return {
      version: 1,
      updated_at: "2026-03-25T12:00:00Z",
      current_stage: "VIDEO",
      next_action: "enter EDITING",
      last_error: null,
      stages: {
        SCRIPT: { status: "locked", artifacts: ["output/script.json"], updated_at: "2026-03-25T11:00:00Z", owner_role: "writer", revision: 2, locked: true },
        STORYBOARD: { status: "approved", artifacts: ["output/storyboard/draft/ep001_storyboard.json"], updated_at: "2026-03-25T11:30:00Z", owner_role: "director", revision: 1, locked: false },
        VIDEO: { status: "completed", artifacts: ["output/ep001/ep001_delivery.json"], updated_at: "2026-03-25T11:45:00Z", owner_role: "production", revision: 1, locked: false },
        EDITING: { status: "not_started", artifacts: [] },
        MUSIC: { status: "not_started", artifacts: [] },
        SUBTITLE: { status: "not_started", artifacts: [] },
      },
      episodes: {
        ep001: {
          storyboard: { status: "approved", artifact: "output/storyboard/draft/ep001_storyboard.json" },
          video: { status: "completed" },
          editing: { status: "not_started" },
          music: { status: "not_started" },
          subtitle: { status: "not_started" },
        },
      },
      artifacts: {
        "output/script.json": {
          kind: "canonical",
          owner_role: "writer",
          status: "locked",
          editable: true,
          revision: 2,
          depends_on: [],
          invalidates: ["output/storyboard/draft/ep001_storyboard.json", "output/ep001/ep001_delivery.json"],
          updated_at: "2026-03-25T11:00:00Z",
          notes: null,
        },
        "output/storyboard/draft/ep001_storyboard.json": {
          kind: "source",
          owner_role: "director",
          status: "approved",
          editable: true,
          revision: 1,
          depends_on: ["output/script.json"],
          invalidates: ["output/ep001/ep001_delivery.json"],
          updated_at: "2026-03-25T11:30:00Z",
          notes: null,
        },
        "output/ep001/ep001_delivery.json": {
          kind: "derived",
          owner_role: "production",
          status: "completed",
          editable: false,
          revision: 1,
          depends_on: ["output/storyboard/draft/ep001_storyboard.json"],
          invalidates: [],
          updated_at: "2026-03-25T11:45:00Z",
          notes: null,
        },
      },
      change_requests: [],
    };
  }

  test("editing script moves current stage back to SCRIPT and invalidates downstream", () => {
    const next = applyManualEditToPipelineState(
      sampleState(),
      "output/script.json",
      "2026-03-25T12:10:00Z",
    );

    expect(next.current_stage).toBe("SCRIPT");
    expect(next.next_action).toBe("review SCRIPT");
    expect(next.stages.SCRIPT?.status).toBe("in_review");
    expect(next.stages.STORYBOARD?.status).toBe("stale");
    expect(next.stages.VIDEO?.status).toBe("stale");
    expect(next.episodes.ep001?.storyboard?.status).toBe("stale");
    expect(next.episodes.ep001?.video?.status).toBe("stale");
    expect(next.artifacts?.["output/script.json"]?.revision).toBe(3);
    expect(next.artifacts?.["output/script.json"]?.status).toBe("in_review");
    expect(next.artifacts?.["output/storyboard/draft/ep001_storyboard.json"]?.status).toBe("stale");
    expect(next.artifacts?.["output/ep001/ep001_delivery.json"]?.status).toBe("stale");
  });

  test("replacing source.txt returns to script review without marking script stale", () => {
    const next = applyManualEditToPipelineState(
      sampleState(),
      "source.txt",
      "2026-03-25T12:05:00Z",
    );

    expect(next.current_stage).toBe("SCRIPT");
    expect(next.next_action).toBe("review SCRIPT");
    expect(next.stages.SCRIPT?.status).toBe("in_review");
    expect(next.stages.STORYBOARD?.status).toBe("stale");
    expect(next.stages.VIDEO?.status).toBe("stale");
    expect(next.artifacts?.["source.txt"]?.kind).toBe("source");
    expect(next.artifacts?.["source.txt"]?.status).toBe("in_review");
  });

  test("editing episode storyboard only invalidates downstream for that episode", () => {
    const next = applyManualEditToPipelineState(
      sampleState(),
      "output/storyboard/draft/ep001_storyboard.json",
      "2026-03-25T12:20:00Z",
    );

    expect(next.current_stage).toBe("STORYBOARD");
    expect(next.next_action).toBe("review STORYBOARD");
    expect(next.stages.STORYBOARD?.status).toBe("in_review");
    expect(next.stages.VIDEO?.status).toBe("stale");
    expect(next.episodes.ep001?.storyboard?.status).toBe("in_review");
    expect(next.episodes.ep001?.video?.status).toBe("stale");
    expect(next.artifacts?.["output/storyboard/draft/ep001_storyboard.json"]?.revision).toBe(2);
    expect(next.artifacts?.["output/storyboard/draft/ep001_storyboard.json"]?.status).toBe("in_review");
  });
});
