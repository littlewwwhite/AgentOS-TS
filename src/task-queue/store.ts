// input: Task lifecycle events (create, update, query)
// output: Persistent task state via SQLite
// pos: Foundation layer — single source of truth for async task persistence

import fs from "node:fs";
import path from "node:path";

import { Database } from "bun:sqlite";

export type TaskStatus =
  | "pending"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskRecord {
  id: string;
  type: string;
  provider: string;
  status: TaskStatus;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  externalId: string | null;
  attempt: number;
  maxAttempts: number;
  phaseId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTaskInput {
  type: string;
  provider: string;
  params: Record<string, unknown>;
  maxAttempts?: number;
  phaseId?: string;
}

export interface TaskStatusUpdate {
  status: TaskStatus;
  externalId?: string;
  result?: Record<string, unknown>;
  error?: string;
  attempt?: number;
}

interface TaskRow {
  id: string;
  type: string;
  provider: string;
  status: string;
  params_json: string;
  result_json: string | null;
  error: string | null;
  external_id: string | null;
  attempt: number;
  max_attempts: number;
  phase_id: string | null;
  created_at: number;
  updated_at: number;
}

export class TaskQueueStore {
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

  create(input: CreateTaskInput): TaskRecord {
    const now = this.nextTimestamp();
    const id = this.generateId();

    this.db
      .query(
        `INSERT INTO tasks (id, type, provider, status, params_json, result_json, error, external_id, attempt, max_attempts, phase_id, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, NULL, NULL, NULL, 0, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        input.provider,
        JSON.stringify(input.params),
        input.maxAttempts ?? 3,
        input.phaseId ?? null,
        now,
        now,
      );

    return this.getById(id)!;
  }

  updateStatus(id: string, update: TaskStatusUpdate): TaskRecord | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = this.nextTimestamp();
    const resultJson =
      update.result !== undefined ? JSON.stringify(update.result) : null;

    this.db
      .query(
        `UPDATE tasks SET
           status = ?,
           external_id = COALESCE(?, external_id),
           result_json = COALESCE(?, result_json),
           error = COALESCE(?, error),
           attempt = COALESCE(?, attempt),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        update.status,
        update.externalId ?? null,
        resultJson,
        update.error ?? null,
        update.attempt ?? null,
        now,
        id,
      );

    return this.getById(id);
  }

  getById(id: string): TaskRecord | null {
    const row = this.db
      .query<TaskRow, [string]>("SELECT * FROM tasks WHERE id = ?")
      .get(id);
    return row ? this.hydrate(row) : null;
  }

  listByStatus(...statuses: TaskStatus[]): TaskRecord[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.db
      .query<TaskRow, TaskStatus[]>(
        `SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY created_at ASC`,
      )
      .all(...statuses);
    return rows.map((r) => this.hydrate(r));
  }

  listByPhase(phaseId: string): TaskRecord[] {
    const rows = this.db
      .query<TaskRow, [string]>(
        "SELECT * FROM tasks WHERE phase_id = ? ORDER BY created_at ASC",
      )
      .all(phaseId);
    return rows.map((r) => this.hydrate(r));
  }

  getMany(ids: string[]): TaskRecord[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .query<TaskRow, string[]>(
        `SELECT * FROM tasks WHERE id IN (${placeholders}) ORDER BY created_at ASC`,
      )
      .all(...ids);
    return rows.map((r) => this.hydrate(r));
  }

  cancel(id: string): boolean {
    const existing = this.getById(id);
    if (!existing) return false;
    if (existing.status === "completed" || existing.status === "failed") {
      return false;
    }
    const now = this.nextTimestamp();
    this.db
      .query("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(now, id);
    return true;
  }

  close(): void {
    this.db.close();
  }

  // -- Internal --

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        params_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        external_id TEXT,
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        phase_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_phase_id ON tasks(phase_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_provider ON tasks(provider);
    `);
  }

  private hydrate(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      type: row.type,
      provider: row.provider,
      status: row.status as TaskStatus,
      params: JSON.parse(row.params_json),
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error,
      externalId: row.external_id,
      attempt: row.attempt,
      maxAttempts: row.max_attempts,
      phaseId: row.phase_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private nextTimestamp(): number {
    const now = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = now;
    return now;
  }

  private generateId(): string {
    return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
