// input: Project identifiers, user auth data, agent session mappings
// output: Unified SQLite-backed persistence for sessions, users, and agent session IDs
// pos: Host state layer — single source of truth replacing JSON files + in-memory auth

import { Database } from "bun:sqlite";

export interface ProjectSession {
  projectId: string;
  sandboxId: string | null;
  createdAt: number;
  updatedAt: number;
  ownerId?: string;
  agentSessionIds: Record<string, string>;
  activeAgent: string | null;
}

export interface ProjectSessionPatch {
  sandboxId?: string | null;
  ownerId?: string;
  agentSessionIds?: Record<string, string>;
  activeAgent?: string | null;
}

export interface SessionStoreOptions {
  filePath?: string;
}

export interface PersistedUser {
  userId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
}

type SessionRow = {
  project_id: string;
  sandbox_id: string | null;
  owner_id: string | null;
  active_agent: string | null;
  created_at: number;
  updated_at: number;
};

type AgentSessionRow = {
  agent_name: string;
  session_id: string;
};

export class SessionStore {
  private db: Database;
  private lastTimestamp = 0;

  // Cached prepared statements
  private readonly stmtGetSession;
  private readonly stmtListSessions;
  private readonly stmtUpdateSession;
  private readonly stmtInsertSession;
  private readonly stmtDeleteSession;
  private readonly stmtGetAgentSessions;
  private readonly stmtDeleteAgentSessions;
  private readonly stmtInsertAgentSession;
  private readonly stmtPersistUser;
  private readonly stmtFindUserByToken;

  constructor(options: SessionStoreOptions = {}) {
    const dbPath = options.filePath ?? ":memory:";
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
    this.migrate();

    this.stmtGetSession = this.db.query<SessionRow, [string]>(
      "SELECT project_id, sandbox_id, owner_id, active_agent, created_at, updated_at FROM sessions WHERE project_id = ?",
    );
    this.stmtListSessions = this.db.query<SessionRow, []>(
      "SELECT project_id, sandbox_id, owner_id, active_agent, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
    );
    this.stmtUpdateSession = this.db.query(
      "UPDATE sessions SET sandbox_id = ?, owner_id = ?, active_agent = ?, updated_at = ? WHERE project_id = ?",
    );
    this.stmtInsertSession = this.db.query(
      "INSERT INTO sessions (project_id, sandbox_id, owner_id, active_agent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.stmtDeleteSession = this.db.query("DELETE FROM sessions WHERE project_id = ?");
    this.stmtGetAgentSessions = this.db.query<AgentSessionRow, [string]>(
      "SELECT agent_name, session_id FROM agent_sessions WHERE project_id = ?",
    );
    this.stmtDeleteAgentSessions = this.db.query("DELETE FROM agent_sessions WHERE project_id = ?");
    this.stmtInsertAgentSession = this.db.query(
      "INSERT INTO agent_sessions (project_id, agent_name, session_id) VALUES (?, ?, ?)",
    );
    this.stmtPersistUser = this.db.query(
      "INSERT OR REPLACE INTO users (id, token, created_at, expires_at) VALUES (?, ?, ?, ?)",
    );
    this.stmtFindUserByToken = this.db.query<{ id: string; expires_at: number }, [string]>(
      "SELECT id, expires_at FROM users WHERE token = ?",
    );
  }

  // -- Session CRUD --

  get(projectId: string): ProjectSession | null {
    const row = this.stmtGetSession.get(projectId);
    if (!row) return null;
    return this.hydrateSession(row);
  }

  list(): ProjectSession[] {
    const rows = this.stmtListSessions.all();
    if (rows.length === 0) return [];

    // Batch-load all agent sessions to avoid N+1 queries
    const allAgentRows = this.db
      .query<{ project_id: string; agent_name: string; session_id: string }, []>(
        "SELECT project_id, agent_name, session_id FROM agent_sessions",
      )
      .all();

    const agentMap = new Map<string, Record<string, string>>();
    for (const r of allAgentRows) {
      let map = agentMap.get(r.project_id);
      if (!map) {
        map = {};
        agentMap.set(r.project_id, map);
      }
      map[r.agent_name] = r.session_id;
    }

    return rows.map((row) => this.rowToSession(row, agentMap.get(row.project_id) ?? {}));
  }

  upsert(projectId: string, patch: ProjectSessionPatch = {}): ProjectSession {
    const now = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = now;

    const existing = this.stmtGetSession.get(projectId);

    let sandboxId: string | null;
    let ownerId: string | null;
    let activeAgent: string | null;
    let createdAt: number;
    let agentSessionIds: Record<string, string>;

    if (existing) {
      sandboxId = patch.sandboxId === undefined ? existing.sandbox_id : (patch.sandboxId ?? null);
      ownerId = patch.ownerId === undefined ? (existing.owner_id ?? null) : (patch.ownerId ?? null);
      activeAgent = patch.activeAgent === undefined ? existing.active_agent : (patch.activeAgent ?? null);
      createdAt = existing.created_at;

      this.stmtUpdateSession.run(sandboxId, ownerId, activeAgent, now, projectId);

      if (patch.agentSessionIds !== undefined) {
        agentSessionIds = normalizeAgentSessionIds(patch.agentSessionIds);
        this.writeAgentSessions(projectId, agentSessionIds);
      } else {
        agentSessionIds = this.getAgentSessions(projectId);
      }
    } else {
      sandboxId = patch.sandboxId ?? null;
      ownerId = patch.ownerId ?? null;
      activeAgent = patch.activeAgent ?? null;
      createdAt = now;

      this.stmtInsertSession.run(projectId, sandboxId, ownerId, activeAgent, now, now);

      if (patch.agentSessionIds !== undefined) {
        agentSessionIds = normalizeAgentSessionIds(patch.agentSessionIds);
        this.writeAgentSessions(projectId, agentSessionIds);
      } else {
        agentSessionIds = {};
      }
    }

    // Build result in-memory instead of re-reading from DB
    return {
      projectId,
      sandboxId,
      createdAt,
      updatedAt: now,
      ...(ownerId ? { ownerId } : {}),
      agentSessionIds,
      activeAgent,
    };
  }

  delete(projectId: string): boolean {
    // CASCADE deletes agent_sessions rows
    const result = this.stmtDeleteSession.run(projectId);
    return result.changes > 0;
  }

  // -- Agent session ID persistence (replaces .sessions.json) --

  getAgentSessions(projectId: string): Record<string, string> {
    const rows = this.stmtGetAgentSessions.all(projectId);
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.agent_name] = row.session_id;
    }
    return result;
  }

  setAgentSessions(projectId: string, data: Record<string, string>): void {
    this.writeAgentSessions(projectId, normalizeAgentSessionIds(data));
  }

  // -- User persistence --

  persistUser(user: PersistedUser): void {
    this.stmtPersistUser.run(user.userId, user.token, user.createdAt, user.expiresAt);
  }

  findUserByToken(token: string): { userId: string; expiresAt: number } | null {
    const row = this.stmtFindUserByToken.get(token);
    if (!row) return null;
    return { userId: row.id, expiresAt: row.expires_at };
  }

  close(): void {
    this.db.close();
  }

  // -- Internal --

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        project_id TEXT PRIMARY KEY,
        sandbox_id TEXT,
        owner_id TEXT,
        active_agent TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        project_id TEXT NOT NULL REFERENCES sessions(project_id) ON DELETE CASCADE,
        agent_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        PRIMARY KEY (project_id, agent_name)
      );
    `);
  }

  private writeAgentSessions(projectId: string, data: Record<string, string>): void {
    this.db.transaction(() => {
      this.stmtDeleteAgentSessions.run(projectId);
      for (const [agentName, sessionId] of Object.entries(data)) {
        if (sessionId) {
          this.stmtInsertAgentSession.run(projectId, agentName, sessionId);
        }
      }
    })();
  }

  private hydrateSession(row: SessionRow): ProjectSession {
    return this.rowToSession(row, this.getAgentSessions(row.project_id));
  }

  private rowToSession(row: SessionRow, agentSessionIds: Record<string, string>): ProjectSession {
    return {
      projectId: row.project_id,
      sandboxId: row.sandbox_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.owner_id ? { ownerId: row.owner_id } : {}),
      agentSessionIds,
      activeAgent: row.active_agent,
    };
  }
}

function normalizeAgentSessionIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
