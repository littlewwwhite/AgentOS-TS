// input: Project identifiers and optional sandbox metadata
// output: In-memory project session records for the host bridge
// pos: Host state layer — minimal metadata store for project-scoped sandboxes

import path from "node:path";

export interface ProjectSession {
  projectId: string;
  sandboxId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSessionPatch {
  sandboxId?: string | null;
}

export class SessionStore {
  private readonly sessions = new Map<string, ProjectSession>();
  private lastTimestamp = 0;

  /**
   * Returns the default on-disk session database path for local mode.
   * The directory is created lazily by SQLite; callers need not mkdir first.
   */
  static defaultPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, ".agentos", "sessions.db");
  }

  get(projectId: string): ProjectSession | null {
    return this.sessions.get(projectId) ?? null;
  }

  list(): ProjectSession[] {
    return [...this.sessions.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  }

  upsert(projectId: string, patch: ProjectSessionPatch = {}): ProjectSession {
    const now = Math.max(Date.now(), this.lastTimestamp + 1);
    this.lastTimestamp = now;
    const existing = this.sessions.get(projectId);

    const session: ProjectSession = existing
      ? {
          ...existing,
          sandboxId:
            patch.sandboxId === undefined ? existing.sandboxId : patch.sandboxId,
          updatedAt: now,
        }
      : {
          projectId,
          sandboxId: patch.sandboxId ?? null,
          createdAt: now,
          updatedAt: now,
        };

    this.sessions.set(projectId, session);
    return session;
  }

  delete(projectId: string): boolean {
    return this.sessions.delete(projectId);
  }
}
