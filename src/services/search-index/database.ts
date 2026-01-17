/**
 * SQLite database management for search index.
 *
 * Handles connection lifecycle, schema migrations, and provides
 * the foundation for path indexing, FTS5, and vector search.
 */

import { Database } from "@db/sqlite";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";

/** Database schema version for migrations */
const SCHEMA_VERSION = 1;

/** Index service configuration */
export interface IndexConfig {
  /** Enable FTS5 full-text search (default: true) */
  enableFts: boolean;
  /** Enable vector embeddings (default: false) */
  enableVectors: boolean;
  /** Maximum file size to index in bytes (default: 1MB) */
  maxFileSize: number;
  /** Embedding model to use */
  embeddingModel: "local" | "openai";
}

/** Default configuration */
export const DEFAULT_CONFIG: IndexConfig = {
  enableFts: true,
  enableVectors: false,
  maxFileSize: 1024 * 1024, // 1MB
  embeddingModel: "local",
};

/** Index statistics */
export interface IndexStats {
  fileCount: number;
  contentIndexedCount: number;
  vectorIndexedCount: number;
  lastIndexedAt: Date | null;
  dbSizeBytes: number;
}

/** Result of an indexing operation */
export interface IndexResult {
  filesIndexed: number;
  filesSkipped: number;
  filesRemoved: number;
  durationMs: number;
}

/**
 * Manages SQLite database for the search index.
 * Provides connection pooling, schema management, and utility methods.
 */
export class IndexDatabase {
  private db: Database | null = null;
  private dbPath: string;
  private config: IndexConfig;

  constructor(projectRoot: string, config: Partial<IndexConfig> = {}) {
    this.dbPath = join(projectRoot, ".panpan", "index.db");
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get the database instance, opening if necessary */
  async getDb(): Promise<Database> {
    if (!this.db) {
      await this.open();
    }
    return this.db!;
  }

  /** Open database connection and ensure schema */
  async open(): Promise<void> {
    if (this.db) return;

    // Ensure .panpan directory exists
    await ensureDir(dirname(this.dbPath));

    // Open database with WAL mode for better concurrency
    this.db = new Database(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA cache_size = -64000"); // 64MB cache

    this.ensureSchema();
  }

  /** Close database connection */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /** Get current configuration */
  getConfig(): IndexConfig {
    return { ...this.config };
  }

  /** Check if database exists */
  async exists(): Promise<boolean> {
    try {
      await Deno.stat(this.dbPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Get index statistics */
  async getStats(): Promise<IndexStats> {
    const db = await this.getDb();

    const fileCount = db.prepare("SELECT COUNT(*) as count FROM files").get<
      { count: number }
    >()?.count ?? 0;

    const contentIndexedCount = this.config.enableFts
      ? db.prepare("SELECT COUNT(*) as count FROM file_content").get<
        { count: number }
      >()?.count ?? 0
      : 0;

    const vectorIndexedCount = this.config.enableVectors
      ? db.prepare("SELECT COUNT(DISTINCT file_id) as count FROM file_vectors")
        .get<{ count: number }>()?.count ?? 0
      : 0;

    const lastIndexed = db.prepare(
      "SELECT MAX(indexed_at) as ts FROM files",
    ).get<{ ts: number | null }>();
    const lastIndexedAt = lastIndexed?.ts
      ? new Date(lastIndexed.ts * 1000)
      : null;

    // Get database file size
    let dbSizeBytes = 0;
    try {
      const stat = await Deno.stat(this.dbPath);
      dbSizeBytes = stat.size;
    } catch {
      // File might not exist yet
    }

    return {
      fileCount,
      contentIndexedCount,
      vectorIndexedCount,
      lastIndexedAt,
      dbSizeBytes,
    };
  }

  /** Ensure database schema is up to date */
  private ensureSchema(): void {
    const db = this.db!;

    // Create metadata table if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Check current schema version
    const versionRow = db.prepare(
      "SELECT value FROM _meta WHERE key = 'schema_version'",
    ).get<{ value: string }>();
    const currentVersion = versionRow ? parseInt(versionRow.value, 10) : 0;

    if (currentVersion < SCHEMA_VERSION) {
      this.migrate(currentVersion, SCHEMA_VERSION);
    }
  }

  /** Run schema migrations */
  private migrate(from: number, to: number): void {
    const db = this.db!;

    for (let version = from + 1; version <= to; version++) {
      switch (version) {
        case 1:
          this.migrateV1();
          break;
      }

      // Update version in metadata
      db.prepare(
        "INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)",
      ).run(version.toString());
    }
  }

  /** Schema version 1: Initial tables */
  private migrateV1(): void {
    const db = this.db!;

    // Files table - path index
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        extension TEXT,
        directory TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        is_binary INTEGER DEFAULT 0
      )
    `);

    db.exec("CREATE INDEX IF NOT EXISTS idx_files_name ON files(name)");
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension)",
    );
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_files_directory ON files(directory)",
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime)");

    // FTS5 table for full-text search
    if (this.config.enableFts) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS file_content USING fts5(
          file_id UNINDEXED,
          path UNINDEXED,
          content,
          tokenize='porter unicode61'
        )
      `);
    }

    // Vector embeddings table
    if (this.config.enableVectors) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_vectors (
          id INTEGER PRIMARY KEY,
          file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          chunk_start INTEGER,
          chunk_end INTEGER,
          chunk_text TEXT,
          embedding BLOB NOT NULL
        )
      `);

      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_vectors_file ON file_vectors(file_id)",
      );
    }

    // Store config
    db.prepare(
      "INSERT OR REPLACE INTO _meta (key, value) VALUES ('config', ?)",
    ).run(JSON.stringify(this.config));
  }

  /** Begin a transaction */
  beginTransaction(): void {
    this.db?.exec("BEGIN TRANSACTION");
  }

  /** Commit a transaction */
  commit(): void {
    this.db?.exec("COMMIT");
  }

  /** Rollback a transaction */
  rollback(): void {
    this.db?.exec("ROLLBACK");
  }

  /** Vacuum the database to reclaim space */
  vacuum(): void {
    this.db?.exec("VACUUM");
  }

  /** Delete the index database completely */
  async deleteIndex(): Promise<void> {
    this.close();
    try {
      await Deno.remove(this.dbPath);
      // Also remove WAL and SHM files if they exist
      await Deno.remove(this.dbPath + "-wal").catch(() => {});
      await Deno.remove(this.dbPath + "-shm").catch(() => {});
    } catch {
      // Database might not exist
    }
  }
}
