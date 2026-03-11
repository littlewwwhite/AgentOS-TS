// input: SQLite file path; Project/Phase/Checkpoint lifecycle events
// output: Persistent engine state (projects, phases, checkpoints)
// pos: Persistence layer — single source of truth for project engine state

import fs from "node:fs";
import path from "node:path";

import { Database } from "bun:sqlite";

import type {
  Project,
  Phase,
  Checkpoint,
  ProjectStatus,
  PhaseStatus,
  CheckpointStatus,
  CreateProjectInput,
  CreatePhaseInput,
  CreateCheckpointInput,
  UpdateCheckpointInput,
} from "./schema.js";

// --- Raw DB row shapes ---

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  config_json: string;
  created_at: number;
  updated_at: number;
}

interface PhaseRow {
  id: string;
  project_id: string;
  name: string;
  agent: string;
  status: string;
  depends_on_json: string;
  order_num: number;
  created_at: number;
  updated_at: number;
}

interface CheckpointRow {
  id: string;
  phase_id: string;
  type: string;
  status: string;
  description: string;
  artifacts_json: string;
  feedback: string | null;
  resolution: string | null;
  revision_count: number;
  created_at: number;
  updated_at: number;
}

export class EngineStore {
  private db: Database;
  private lastTimestamp = 0;

  constructor(filePath: string = ":memory:") {
    if (filePath !== ":memory:") {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.db = new Database(filePath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.migrate();
  }

  // --- Projects ---

  createProject(input: CreateProjectInput): Project {
    const now = this.nextTimestamp();
    const id = this.generateId("proj");
    this.db
      .query(
        `INSERT INTO projects (id, name, status, config_json, created_at, updated_at)
         VALUES (?, ?, 'draft', ?, ?, ?)`,
      )
      .run(id, input.name, JSON.stringify(input.config ?? {}), now, now);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | null {
    const row = this.db
      .query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?")
      .get(id);
    return row ? this.hydrateProject(row) : null;
  }

  listProjects(status?: ProjectStatus): Project[] {
    if (status) {
      const rows = this.db
        .query<ProjectRow, [string]>(
          "SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC",
        )
        .all(status);
      return rows.map((r) => this.hydrateProject(r));
    }
    const rows = this.db
      .query<ProjectRow, []>("SELECT * FROM projects ORDER BY created_at DESC")
      .all();
    return rows.map((r) => this.hydrateProject(r));
  }

  updateProjectStatus(id: string, status: ProjectStatus): Project | null {
    const existing = this.getProject(id);
    if (!existing) return null;
    const now = this.nextTimestamp();
    this.db
      .query("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, id);
    return this.getProject(id);
  }

  // --- Phases ---

  createPhase(input: CreatePhaseInput): Phase {
    const now = this.nextTimestamp();
    const id = this.generateId("phase");
    this.db
      .query(
        `INSERT INTO phases (id, project_id, name, agent, status, depends_on_json, order_num, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.name,
        input.agent,
        JSON.stringify(input.dependsOn ?? []),
        input.order ?? 0,
        now,
        now,
      );
    return this.getPhase(id)!;
  }

  getPhase(id: string): Phase | null {
    const row = this.db
      .query<PhaseRow, [string]>("SELECT * FROM phases WHERE id = ?")
      .get(id);
    return row ? this.hydratePhase(row) : null;
  }

  listPhasesByProject(projectId: string): Phase[] {
    const rows = this.db
      .query<PhaseRow, [string]>(
        "SELECT * FROM phases WHERE project_id = ? ORDER BY order_num ASC, created_at ASC",
      )
      .all(projectId);
    return rows.map((r) => this.hydratePhase(r));
  }

  updatePhaseStatus(id: string, status: PhaseStatus): Phase | null {
    const existing = this.getPhase(id);
    if (!existing) return null;
    const now = this.nextTimestamp();
    this.db
      .query("UPDATE phases SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, now, id);
    return this.getPhase(id);
  }

  /**
   * Return phases whose every dependency is already completed.
   * Only considers phases currently in 'pending' status.
   */
  getReadyPhases(projectId: string): Phase[] {
    const phases = this.listPhasesByProject(projectId);
    const completedIds = new Set(
      phases.filter((p) => p.status === "completed").map((p) => p.id),
    );
    return phases.filter(
      (p) =>
        p.status === "pending" &&
        p.dependsOn.every((depId) => completedIds.has(depId)),
    );
  }

  // --- Checkpoints ---

  createCheckpoint(input: CreateCheckpointInput): Checkpoint {
    const now = this.nextTimestamp();
    const id = this.generateId("ckpt");
    this.db
      .query(
        `INSERT INTO checkpoints (id, phase_id, type, status, description, artifacts_json, feedback, resolution, revision_count, created_at, updated_at)
         VALUES (?, ?, ?, 'created', ?, ?, NULL, NULL, 0, ?, ?)`,
      )
      .run(
        id,
        input.phaseId,
        input.type,
        input.description,
        JSON.stringify(input.artifacts ?? []),
        now,
        now,
      );
    return this.getCheckpoint(id)!;
  }

  getCheckpoint(id: string): Checkpoint | null {
    const row = this.db
      .query<CheckpointRow, [string]>("SELECT * FROM checkpoints WHERE id = ?")
      .get(id);
    return row ? this.hydrateCheckpoint(row) : null;
  }

  listCheckpointsByPhase(phaseId: string): Checkpoint[] {
    const rows = this.db
      .query<CheckpointRow, [string]>(
        "SELECT * FROM checkpoints WHERE phase_id = ? ORDER BY created_at ASC",
      )
      .all(phaseId);
    return rows.map((r) => this.hydrateCheckpoint(r));
  }

  updateCheckpoint(id: string, update: UpdateCheckpointInput): Checkpoint | null {
    const existing = this.getCheckpoint(id);
    if (!existing) return null;

    const now = this.nextTimestamp();
    this.db
      .query(
        `UPDATE checkpoints SET
           status = COALESCE(?, status),
           feedback = COALESCE(?, feedback),
           resolution = COALESCE(?, resolution),
           revision_count = COALESCE(?, revision_count),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        update.status ?? null,
        update.feedback ?? null,
        update.resolution ?? null,
        update.revisionCount ?? null,
        now,
        id,
      );
    return this.getCheckpoint(id);
  }

  /**
   * Return all checkpoints in 'created' or 'presented' state across a project.
   */
  getPendingCheckpoints(projectId: string): Checkpoint[] {
    const rows = this.db
      .query<CheckpointRow, [string]>(
        `SELECT c.* FROM checkpoints c
         JOIN phases p ON p.id = c.phase_id
         WHERE p.project_id = ?
           AND c.status IN ('created', 'presented')
         ORDER BY c.created_at ASC`,
      )
      .all(projectId);
    return rows.map((r) => this.hydrateCheckpoint(r));
  }

  close(): void {
    this.db.close();
  }

  // --- Internal ---

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS phases (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        agent TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        depends_on_json TEXT NOT NULL DEFAULT '[]',
        order_num INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_phases_project_id ON phases(project_id);
      CREATE INDEX IF NOT EXISTS idx_phases_status ON phases(status);

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        phase_id TEXT NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        description TEXT NOT NULL,
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        feedback TEXT,
        resolution TEXT,
        revision_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_phase_id ON checkpoints(phase_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON checkpoints(status);
    `);
  }

  private hydrateProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      status: row.status as Project["status"],
      config: JSON.parse(row.config_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydratePhase(row: PhaseRow): Phase {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      agent: row.agent,
      status: row.status as Phase["status"],
      dependsOn: JSON.parse(row.depends_on_json),
      order: row.order_num,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydrateCheckpoint(row: CheckpointRow): Checkpoint {
    return {
      id: row.id,
      phaseId: row.phase_id,
      type: row.type as Checkpoint["type"],
      status: row.status as CheckpointStatus,
      description: row.description,
      artifacts: JSON.parse(row.artifacts_json),
      feedback: row.feedback,
      resolution: row.resolution,
      revisionCount: row.revision_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private nextTimestamp(): number {
    const now = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = now;
    return now;
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
