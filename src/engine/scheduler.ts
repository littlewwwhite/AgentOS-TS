// input: EngineStore instance; phase completion and checkpoint resolution events
// output: Phase activation decisions based on DAG dependency resolution
// pos: Orchestration layer — advances project execution by evaluating DAG readiness

import type { EngineStore } from "./store.js";
import type { Phase } from "./schema.js";

export class ProjectScheduler {
  constructor(private readonly store: EngineStore) {}

  /**
   * Scan the project for all pending phases whose dependencies are fully completed
   * and mark them as active. Returns the newly activated phases.
   */
  advanceProject(projectId: string): Phase[] {
    const ready = this.store.getReadyPhases(projectId);
    const activated: Phase[] = [];

    for (const phase of ready) {
      const updated = this.store.updatePhaseStatus(phase.id, "active");
      if (updated) activated.push(updated);
    }

    // If all phases are done, mark project as completed
    const allPhases = this.store.listPhasesByProject(projectId);
    const allDone =
      allPhases.length > 0 &&
      allPhases.every(
        (p) => p.status === "completed" || p.status === "skipped",
      );
    if (allDone) {
      this.store.updateProjectStatus(projectId, "completed");
    }

    return activated;
  }

  /**
   * Called when an agent finishes a phase. Updates the phase status, then
   * re-evaluates the DAG to start any newly unblocked downstream phases.
   */
  onPhaseCompleted(phaseId: string): Phase[] {
    const phase = this.store.getPhase(phaseId);
    if (!phase) return [];

    this.store.updatePhaseStatus(phaseId, "completed");
    return this.advanceProject(phase.projectId);
  }

  /**
   * Called when a human reviewer resolves a checkpoint.
   *
   * - approved:  phase continues (agent re-awakened without revision context)
   * - revised:   agent re-awakened with feedback so it can revise its output
   * - rejected:  phase is marked failed and project pauses on that branch
   */
  onCheckpointResolved(
    checkpointId: string,
    decision: "approved" | "revised" | "rejected",
    feedback?: string,
  ): void {
    const checkpoint = this.store.getCheckpoint(checkpointId);
    if (!checkpoint) return;

    const newRevisionCount =
      decision === "revised"
        ? checkpoint.revisionCount + 1
        : checkpoint.revisionCount;

    this.store.updateCheckpoint(checkpointId, {
      status: "resolved",
      resolution: decision,
      feedback: feedback ?? checkpoint.feedback ?? undefined,
      revisionCount: newRevisionCount,
    });

    if (decision === "rejected") {
      // Fail the owning phase — downstream phases remain pending (blocked)
      this.store.updatePhaseStatus(checkpoint.phaseId, "failed");

      const phase = this.store.getPhase(checkpoint.phaseId);
      if (phase) {
        const project = this.store.getProject(phase.projectId);
        if (project && project.status === "active") {
          this.store.updateProjectStatus(phase.projectId, "paused");
        }
      }
    }
    // For "approved" and "revised", the consuming agent is responsible for
    // re-reading the checkpoint and deciding its next action.
    // The scheduler does not directly awaken agents — that is the runtime's job.
  }
}
