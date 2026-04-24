import { describe, expect, test } from "bun:test";
import type { PipelineState, StageStatus } from "../src/types";
import { getResumeDecision } from "../src/lib/resumePolicy";

const STAGES = ["SCRIPT", "VISUAL", "STORYBOARD", "VIDEO", "EDITING", "MUSIC", "SUBTITLE"];

function stage(status: StageStatus, artifacts: string[] = []) {
  return { status, artifacts };
}

function baseState(): PipelineState {
  return {
    version: 1,
    updated_at: "2026-03-25T12:00:00Z",
    current_stage: "VIDEO",
    next_action: "enter VIDEO",
    last_error: null,
    stages: Object.fromEntries(STAGES.map((name) => [name, stage("not_started")])) as PipelineState["stages"],
    episodes: {},
    artifacts: {},
    change_requests: [],
  };
}

describe("getResumeDecision", () => {
  test("requires review before continuing when an upstream artifact is in review", () => {
    const state = baseState();
    state.stages.SCRIPT = stage("in_review", ["output/script.json"]);
    state.stages.STORYBOARD = stage("stale", ["output/ep001/ep001_storyboard.json"]);
    state.stages.VIDEO = stage("stale", ["output/ep001/ep001_delivery.json"]);
    state.artifacts = {
      "output/script.json": {
        kind: "canonical",
        owner_role: "writer",
        status: "in_review",
        editable: true,
        revision: 3,
        depends_on: [],
        invalidates: ["output/ep001/ep001_storyboard.json"],
      },
    };

    expect(getResumeDecision(state)).toMatchObject({
      kind: "review_required",
      stage: "SCRIPT",
      targetArtifact: "output/script.json",
    });
  });

  test("resumes at the first stale downstream stage after upstream approval", () => {
    const state = baseState();
    state.stages.SCRIPT = stage("locked", ["output/script.json"]);
    state.stages.VISUAL = stage("approved", ["output/actors/actors.json"]);
    state.stages.STORYBOARD = stage("stale", ["output/ep001/ep001_storyboard.json"]);
    state.stages.VIDEO = stage("stale", ["output/ep001/ep001_delivery.json"]);

    expect(getResumeDecision(state)).toMatchObject({
      kind: "resume",
      stage: "STORYBOARD",
      action: "regenerate",
    });
  });

  test("does not skip a stale video stage into editing", () => {
    const state = baseState();
    state.stages.SCRIPT = stage("locked", ["output/script.json"]);
    state.stages.VISUAL = stage("approved");
    state.stages.STORYBOARD = stage("approved", ["output/ep001/ep001_storyboard.json"]);
    state.stages.VIDEO = stage("stale", ["output/ep001/ep001_delivery.json"]);
    state.stages.EDITING = stage("not_started");

    expect(getResumeDecision(state)).toMatchObject({
      kind: "resume",
      stage: "VIDEO",
      action: "regenerate",
    });
  });

  test("routes open change requests to the target artifact stage", () => {
    const state = baseState();
    state.stages.SCRIPT = stage("locked", ["output/script.json"]);
    state.stages.STORYBOARD = stage("change_requested", ["output/ep001/ep001_storyboard.json"]);
    state.change_requests = [{
      id: "cr_001",
      target_artifact: "output/script.json",
      requested_by_role: "director",
      reason: "主角动机不成立",
      created_at: "2026-03-25T12:30:00Z",
      status: "open",
    }];

    expect(getResumeDecision(state)).toMatchObject({
      kind: "revision_required",
      stage: "SCRIPT",
      targetArtifact: "output/script.json",
      reason: "主角动机不成立",
    });
  });

  test("reports complete when every stage is terminal", () => {
    const state = baseState();
    for (const name of STAGES) {
      state.stages[name] = stage("locked");
    }

    expect(getResumeDecision(state)).toMatchObject({
      kind: "complete",
      stage: null,
    });
  });

  test("ignores paused inspiration stage when deciding where to resume", () => {
    const state = baseState();
    state.stages.INSPIRATION = stage("not_started", ["output/inspiration.json"]);

    expect(getResumeDecision(state)).toMatchObject({
      kind: "resume",
      stage: "SCRIPT",
      action: "start",
    });
  });
});
