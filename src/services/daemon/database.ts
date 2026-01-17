/**
 * SQLite database for daemon state persistence.
 *
 * Stores sessions and tasks with proper schema migrations.
 * Uses WAL mode for better concurrent access.
 */

import { Database } from "@db/sqlite";
import { ensureDir } from "@std/fs";
import { dirname } from "@std/path";
import type {
  Session,
  SessionCreate,
  SessionUpdate,
  Task,
  TaskCreate,
  TaskUpdate,
} from "./types.ts";

/** Current schema version */
const SCHEMA_VERSION = 1;

/**
 * Database for storing daemon sessions and tasks.
 */
export class DaemonDatabase {
  private db: Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /** Open the database connection */
  async open(): Promise<void> {
    if (this.db) return;

    // Ensure directory exists
    await ensureDir(dirname(this.dbPath));

    // Open with WAL mode for better concurrency
    this.db = new Database(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    this.ensureSchema();
  }

  /** Close the database connection */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Check if database is open */
  isOpen(): boolean {
    return this.db !== null;
  }

  /** Get the database path */
  getPath(): string {
    return this.dbPath;
  }

  // ===========================================================================
  // Schema Management
  // ===========================================================================

  private ensureSchema(): void {
    const db = this.db!;

    // Create metadata table
    db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Check current version
    const row = db.prepare(
      "SELECT value FROM _meta WHERE key = 'schema_version'",
    ).get<{ value: string }>();
    const currentVersion = row ? parseInt(row.value, 10) : 0;

    if (currentVersion < SCHEMA_VERSION) {
      this.migrate(currentVersion, SCHEMA_VERSION);
    }
  }

  private migrate(from: number, to: number): void {
    const db = this.db!;

    for (let version = from + 1; version <= to; version++) {
      switch (version) {
        case 1:
          this.migrateV1();
          break;
      }

      db.prepare(
        "INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)",
      ).run(version.toString());
    }
  }

  private migrateV1(): void {
    const db = this.db!;

    // Sessions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata TEXT
      )
    `);

    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_root)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at)",
    );

    // Tasks table
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        error TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)",
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
  }

  // ===========================================================================
  // Session CRUD
  // ===========================================================================

  /** Create a new session */
  createSession(input: SessionCreate): Session {
    const db = this.db!;
    const now = Date.now();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO sessions (id, project_root, model, status, created_at, updated_at, metadata)
      VALUES (?, ?, ?, 'active', ?, ?, ?)
    `).run(
      id,
      input.projectRoot,
      input.model,
      now,
      now,
      input.metadata ? JSON.stringify(input.metadata) : null,
    );

    return {
      id,
      projectRoot: input.projectRoot,
      model: input.model,
      status: "active",
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };
  }

  /** Get a session by ID */
  getSession(id: string): Session | null {
    const db = this.db!;
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get<{
      id: string;
      project_root: string;
      model: string;
      status: string;
      created_at: number;
      updated_at: number;
      completed_at: number | null;
      metadata: string | null;
    }>(id);

    if (!row) return null;

    return this.rowToSession(row);
  }

  /** List sessions with optional filtering */
  listSessions(options?: {
    status?: string;
    projectRoot?: string;
    limit?: number;
    offset?: number;
  }): Session[] {
    const db = this.db!;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options?.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }
    if (options?.projectRoot) {
      conditions.push("project_root = ?");
      params.push(options.projectRoot);
    }

    let sql = "SELECT * FROM sessions";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY created_at DESC";

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    if (options?.offset) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }

    type SessionRow = {
      id: string;
      project_root: string;
      model: string;
      status: string;
      created_at: number;
      updated_at: number;
      completed_at: number | null;
      metadata: string | null;
    };

    const stmt = db.prepare(sql);
    const rows = params.length > 0
      ? stmt.all<SessionRow>(...params)
      : stmt.all<SessionRow>();

    return rows.map((row) => this.rowToSession(row));
  }

  /** Update a session */
  updateSession(id: string, update: SessionUpdate): Session | null {
    const db = this.db!;
    const fields: string[] = ["updated_at = ?"];
    const params: (string | number)[] = [Date.now()];

    if (update.status !== undefined) {
      fields.push("status = ?");
      params.push(update.status);
    }
    if (update.completedAt !== undefined) {
      fields.push("completed_at = ?");
      params.push(update.completedAt);
    }
    if (update.metadata !== undefined) {
      fields.push("metadata = ?");
      params.push(JSON.stringify(update.metadata));
    }

    params.push(id);

    const sql = `UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`;
    const result = db.prepare(sql).run(...params);

    if (result === 0) return null;

    return this.getSession(id);
  }

  /** Delete a session and its tasks (cascading) */
  deleteSession(id: string): boolean {
    const db = this.db!;
    const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return result > 0;
  }

  private rowToSession(row: {
    id: string;
    project_root: string;
    model: string;
    status: string;
    created_at: number;
    updated_at: number;
    completed_at: number | null;
    metadata: string | null;
  }): Session {
    return {
      id: row.id,
      projectRoot: row.project_root,
      model: row.model,
      status: row.status as Session["status"],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  // ===========================================================================
  // Task CRUD
  // ===========================================================================

  /** Create a new task */
  createTask(input: TaskCreate): Task {
    const db = this.db!;
    const now = Date.now();
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO tasks (id, session_id, type, description, status, started_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, input.sessionId, input.type, input.description, now);

    return {
      id,
      sessionId: input.sessionId,
      type: input.type,
      description: input.description,
      status: "pending",
      startedAt: now,
    };
  }

  /** Get a task by ID */
  getTask(id: string): Task | null {
    const db = this.db!;
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get<{
      id: string;
      session_id: string;
      type: string;
      description: string;
      status: string;
      result: string | null;
      error: string | null;
      started_at: number;
      completed_at: number | null;
    }>(id);

    if (!row) return null;

    return this.rowToTask(row);
  }

  /** List tasks for a session */
  listTasks(options?: {
    sessionId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Task[] {
    const db = this.db!;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options?.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }
    if (options?.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }

    let sql = "SELECT * FROM tasks";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY started_at DESC";

    if (options?.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }
    if (options?.offset) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }

    type TaskRow = {
      id: string;
      session_id: string;
      type: string;
      description: string;
      status: string;
      result: string | null;
      error: string | null;
      started_at: number;
      completed_at: number | null;
    };

    const stmt = db.prepare(sql);
    const rows = params.length > 0
      ? stmt.all<TaskRow>(...params)
      : stmt.all<TaskRow>();

    return rows.map((row) => this.rowToTask(row));
  }

  /** Update a task */
  updateTask(id: string, update: TaskUpdate): Task | null {
    const db = this.db!;
    const fields: string[] = [];
    const params: (string | number)[] = [];

    if (update.status !== undefined) {
      fields.push("status = ?");
      params.push(update.status);
    }
    if (update.result !== undefined) {
      fields.push("result = ?");
      params.push(update.result);
    }
    if (update.error !== undefined) {
      fields.push("error = ?");
      params.push(update.error);
    }
    if (update.completedAt !== undefined) {
      fields.push("completed_at = ?");
      params.push(update.completedAt);
    }

    if (fields.length === 0) return this.getTask(id);

    params.push(id);

    const sql = `UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`;
    const result = db.prepare(sql).run(...params);

    if (result === 0) return null;

    return this.getTask(id);
  }

  /** Delete a task */
  deleteTask(id: string): boolean {
    const db = this.db!;
    const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return result > 0;
  }

  private rowToTask(row: {
    id: string;
    session_id: string;
    type: string;
    description: string;
    status: string;
    result: string | null;
    error: string | null;
    started_at: number;
    completed_at: number | null;
  }): Task {
    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      description: row.description,
      status: row.status as Task["status"],
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  // ===========================================================================
  // Maintenance
  // ===========================================================================

  /** Vacuum the database */
  vacuum(): void {
    this.db?.exec("VACUUM");
  }

  /** Delete the database file */
  async delete(): Promise<void> {
    this.close();
    try {
      await Deno.remove(this.dbPath);
      await Deno.remove(this.dbPath + "-wal").catch(() => {});
      await Deno.remove(this.dbPath + "-shm").catch(() => {});
    } catch {
      // Database might not exist
    }
  }
}
