import { describe, expect, it } from "vitest";
import { EngineStore } from "../src/engine/store.js";
import { ProjectScheduler } from "../src/engine/scheduler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): EngineStore {
  return new EngineStore(); // in-memory
}

function makeScheduler(store: EngineStore): ProjectScheduler {
  return new ProjectScheduler(store);
}

// ---------------------------------------------------------------------------
// advanceProject
// ---------------------------------------------------------------------------

describe("ProjectScheduler.advanceProject", () => {
  it("activates phases with no dependencies immediately", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });

    const p1 = store.createPhase({ projectId: project.id, name: "Scripting", agent: "writer", order: 0 });
    const p2 = store.createPhase({ projectId: project.id, name: "Storyboard", agent: "artist", order: 1 });

    const activated = scheduler.advanceProject(project.id);

    expect(activated.map((p) => p.id)).toContain(p1.id);
    expect(activated.map((p) => p.id)).toContain(p2.id);

    expect(store.getPhase(p1.id)!.status).toBe("active");
    expect(store.getPhase(p2.id)!.status).toBe("active");
  });

  it("skips phases with unmet dependencies", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });

    const p1 = store.createPhase({ projectId: project.id, name: "P1", agent: "a", order: 0 });
    const p2 = store.createPhase({
      projectId: project.id,
      name: "P2",
      agent: "b",
      dependsOn: [p1.id],
      order: 1,
    });

    const activated = scheduler.advanceProject(project.id);

    // Only P1 has no deps — P2 must remain pending
    expect(activated.map((p) => p.id)).toContain(p1.id);
    expect(activated.map((p) => p.id)).not.toContain(p2.id);
    expect(store.getPhase(p2.id)!.status).toBe("pending");
  });

  it("marks project as completed when all phases are completed or skipped", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });

    const p1 = store.createPhase({ projectId: project.id, name: "Only Phase", agent: "a" });
    store.updatePhaseStatus(p1.id, "completed");

    scheduler.advanceProject(project.id);

    expect(store.getProject(project.id)!.status).toBe("completed");
  });

  it("does not mark project completed while any phase is still pending or active", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });

    const p1 = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    const p2 = store.createPhase({ projectId: project.id, name: "P2", agent: "b" });

    store.updatePhaseStatus(p1.id, "completed");
    // p2 still pending
    scheduler.advanceProject(project.id);

    expect(store.getProject(project.id)!.status).toBe("draft"); // unchanged
  });

  it("does not re-activate already active phases", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });

    const p1 = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    store.updatePhaseStatus(p1.id, "active");

    // advanceProject only touches pending phases
    const activated = scheduler.advanceProject(project.id);
    expect(activated).toHaveLength(0);
    expect(store.getPhase(p1.id)!.status).toBe("active");
  });

  it("skipped phases count as done for project completion check", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });

    const p1 = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    const p2 = store.createPhase({ projectId: project.id, name: "P2", agent: "b" });

    store.updatePhaseStatus(p1.id, "completed");
    store.updatePhaseStatus(p2.id, "skipped");

    scheduler.advanceProject(project.id);

    expect(store.getProject(project.id)!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// onPhaseCompleted
// ---------------------------------------------------------------------------

describe("ProjectScheduler.onPhaseCompleted", () => {
  it("marks the phase completed and advances dependent phases", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });

    const p1 = store.createPhase({ projectId: project.id, name: "P1", agent: "a", order: 0 });
    const p2 = store.createPhase({
      projectId: project.id,
      name: "P2",
      agent: "b",
      dependsOn: [p1.id],
      order: 1,
    });

    // Activate P1 first (would normally come from advanceProject)
    store.updatePhaseStatus(p1.id, "active");

    const newlyActivated = scheduler.onPhaseCompleted(p1.id);

    expect(store.getPhase(p1.id)!.status).toBe("completed");
    expect(store.getPhase(p2.id)!.status).toBe("active");
    expect(newlyActivated.map((p) => p.id)).toContain(p2.id);
  });

  it("returns empty array for nonexistent phase id", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const result = scheduler.onPhaseCompleted("nonexistent");
    expect(result).toEqual([]);
  });

  it("marks project completed when last phase finishes", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });
    const phase = store.createPhase({ projectId: project.id, name: "Only", agent: "a" });
    store.updateProjectStatus(project.id, "active");

    scheduler.onPhaseCompleted(phase.id);

    expect(store.getProject(project.id)!.status).toBe("completed");
  });

  it("only unlocks downstream phases when all their deps are satisfied", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });

    const p1 = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    const p2 = store.createPhase({ projectId: project.id, name: "P2", agent: "b" });
    const p3 = store.createPhase({
      projectId: project.id,
      name: "P3",
      agent: "c",
      dependsOn: [p1.id, p2.id],
    });

    // Complete P1 only
    scheduler.onPhaseCompleted(p1.id);

    // P3 still blocked by P2
    expect(store.getPhase(p3.id)!.status).toBe("pending");

    // Complete P2 — now P3 should become active
    scheduler.onPhaseCompleted(p2.id);
    expect(store.getPhase(p3.id)!.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// onCheckpointResolved — approved
// ---------------------------------------------------------------------------

describe("ProjectScheduler.onCheckpointResolved — approved", () => {
  it("sets checkpoint to resolved with resolution=approved; phase status stays active", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });
    store.updateProjectStatus(project.id, "active");
    const phase = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    store.updatePhaseStatus(phase.id, "active");

    const ckpt = store.createCheckpoint({
      phaseId: phase.id,
      type: "review",
      description: "Check the draft",
    });

    scheduler.onCheckpointResolved(ckpt.id, "approved");

    const updated = store.getCheckpoint(ckpt.id)!;
    expect(updated.status).toBe("resolved");
    expect(updated.resolution).toBe("approved");
    // revision count unchanged
    expect(updated.revisionCount).toBe(0);

    // Phase continues — status unchanged
    expect(store.getPhase(phase.id)!.status).toBe("active");
    // Project also unchanged
    expect(store.getProject(project.id)!.status).toBe("active");
  });

  it("accepts optional feedback with approved decision", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });
    const phase = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    const ckpt = store.createCheckpoint({ phaseId: phase.id, type: "approval", description: "Sign off" });

    scheduler.onCheckpointResolved(ckpt.id, "approved", "Minor notes, but approved");

    const updated = store.getCheckpoint(ckpt.id)!;
    expect(updated.resolution).toBe("approved");
    expect(updated.feedback).toBe("Minor notes, but approved");
  });
});

// ---------------------------------------------------------------------------
// onCheckpointResolved — revised
// ---------------------------------------------------------------------------

describe("ProjectScheduler.onCheckpointResolved — revised", () => {
  it("sets checkpoint to resolved with resolution=revised and increments revisionCount", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });
    const phase = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    store.updatePhaseStatus(phase.id, "active");

    const ckpt = store.createCheckpoint({
      phaseId: phase.id,
      type: "review",
      description: "Draft review",
    });

    scheduler.onCheckpointResolved(ckpt.id, "revised", "Please rewrite the opening");

    const updated = store.getCheckpoint(ckpt.id)!;
    expect(updated.status).toBe("resolved");
    expect(updated.resolution).toBe("revised");
    expect(updated.feedback).toBe("Please rewrite the opening");
    expect(updated.revisionCount).toBe(1); // incremented from 0
  });

  it("accumulates revision count across multiple revisions", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });
    const phase = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });

    const ckpt = store.createCheckpoint({ phaseId: phase.id, type: "review", description: "Review" });

    // First revision
    scheduler.onCheckpointResolved(ckpt.id, "revised", "First feedback");
    expect(store.getCheckpoint(ckpt.id)!.revisionCount).toBe(1);

    // Reset to created so we can resolve again (simulate agent re-submitting)
    store.updateCheckpoint(ckpt.id, { status: "created" });

    // Second revision — revisionCount was already 1, should become 2
    scheduler.onCheckpointResolved(ckpt.id, "revised", "Second feedback");
    expect(store.getCheckpoint(ckpt.id)!.revisionCount).toBe(2);
  });

  it("phase status is not directly changed on revised decision", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });
    const phase = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    store.updatePhaseStatus(phase.id, "active");

    const ckpt = store.createCheckpoint({ phaseId: phase.id, type: "review", description: "R" });
    scheduler.onCheckpointResolved(ckpt.id, "revised", "Needs work");

    // The scheduler does not change phase status for revised — the agent runtime handles re-wake
    expect(store.getPhase(phase.id)!.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// onCheckpointResolved — rejected
// ---------------------------------------------------------------------------

describe("ProjectScheduler.onCheckpointResolved — rejected", () => {
  it("sets checkpoint to resolved, fails the phase, and pauses the project", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });
    store.updateProjectStatus(project.id, "active");

    const phase = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    store.updatePhaseStatus(phase.id, "active");

    const ckpt = store.createCheckpoint({
      phaseId: phase.id,
      type: "quality_gate",
      description: "Quality check",
    });

    scheduler.onCheckpointResolved(ckpt.id, "rejected", "Does not meet standards");

    const updatedCkpt = store.getCheckpoint(ckpt.id)!;
    expect(updatedCkpt.status).toBe("resolved");
    expect(updatedCkpt.resolution).toBe("rejected");
    expect(updatedCkpt.feedback).toBe("Does not meet standards");

    // Phase must be failed
    expect(store.getPhase(phase.id)!.status).toBe("failed");

    // Project must be paused
    expect(store.getProject(project.id)!.status).toBe("paused");
  });

  it("pauses project only if it was active at the time of rejection", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    // Project stays in "draft" status — should NOT be paused
    const project = store.createProject({ name: "Film" });
    const phase = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    const ckpt = store.createCheckpoint({ phaseId: phase.id, type: "review", description: "R" });

    scheduler.onCheckpointResolved(ckpt.id, "rejected");

    expect(store.getPhase(phase.id)!.status).toBe("failed");
    // Project was draft, not active — status must remain draft
    expect(store.getProject(project.id)!.status).toBe("draft");
  });

  it("downstream phases remain pending after rejection", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    const project = store.createProject({ name: "Film" });
    store.updateProjectStatus(project.id, "active");

    const p1 = store.createPhase({ projectId: project.id, name: "P1", agent: "a" });
    const p2 = store.createPhase({
      projectId: project.id,
      name: "P2",
      agent: "b",
      dependsOn: [p1.id],
    });

    store.updatePhaseStatus(p1.id, "active");
    const ckpt = store.createCheckpoint({ phaseId: p1.id, type: "review", description: "R" });

    scheduler.onCheckpointResolved(ckpt.id, "rejected");

    // P2 depends on P1 which is now failed — it must remain pending (not activated)
    expect(store.getPhase(p2.id)!.status).toBe("pending");
  });

  it("is a no-op for nonexistent checkpoint id", () => {
    const store = makeStore();
    const scheduler = makeScheduler(store);
    // Must not throw
    expect(() => scheduler.onCheckpointResolved("nonexistent", "rejected")).not.toThrow();
  });
});
