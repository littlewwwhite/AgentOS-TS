// input: none — pure type definitions
// output: Project, Phase, Checkpoint data models and status enums
// pos: Schema layer — shared contracts for all engine modules

export type ProjectStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type PhaseStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "skipped";

export type CheckpointStatus =
  | "created"
  | "presented"
  | "approved"
  | "revised"
  | "rejected"
  | "resolved";

export type CheckpointType =
  | "review"
  | "approval"
  | "quality_gate"
  | "milestone";

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  /** Project-level config: bypass mode, custom settings, etc. */
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  /** Which agent handles this phase */
  agent: string;
  status: PhaseStatus;
  /** Phase IDs this phase depends on (DAG edges) */
  dependsOn: string[];
  /** Execution order hint for display/sorting */
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Checkpoint {
  id: string;
  phaseId: string;
  type: CheckpointType;
  status: CheckpointStatus;
  description: string;
  /** File paths of artifacts attached to this checkpoint */
  artifacts: string[];
  /** Reviewer feedback text */
  feedback: string | null;
  /** Final resolution: "approved" | "revised" | "rejected" */
  resolution: string | null;
  revisionCount: number;
  createdAt: number;
  updatedAt: number;
}

// --- Input types for creation ---

export interface CreateProjectInput {
  name: string;
  config?: Record<string, unknown>;
}

export interface CreatePhaseInput {
  projectId: string;
  name: string;
  agent: string;
  dependsOn?: string[];
  order?: number;
}

export interface CreateCheckpointInput {
  phaseId: string;
  type: CheckpointType;
  description: string;
  artifacts?: string[];
}

export interface UpdateCheckpointInput {
  status?: CheckpointStatus;
  feedback?: string;
  resolution?: string;
  revisionCount?: number;
}
