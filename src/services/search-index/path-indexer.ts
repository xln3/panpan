/**
 * File path indexer for fast glob matching.
 *
 * Scans the filesystem and maintains a SQLite index of all file paths,
 * enabling sub-millisecond glob pattern matching on large codebases.
 */

import { walk } from "@std/fs";
import {
  basename,
  dirname,
  extname,
  globToRegExp,
  relative,
  resolve,
} from "@std/path";
import type { IndexDatabase, IndexResult } from "./database.ts";
import { createGitignoreParser, type GitignoreParser } from "./gitignore-parser.ts";

/** File entry stored in the index */
export interface FileEntry {
  id: number;
  path: string;
  name: string;
  extension: string | null;
  directory: string;
  mtime: number;
  size: number;
  indexedAt: number;
  isBinary: boolean;
}

/** Options for glob queries */
export interface GlobQueryOptions {
  /** Maximum results to return */
  limit?: number;
  /** Include binary files in results */
  includeBinary?: boolean;
}

/** Common binary file extensions */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".bin",
  ".dat",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".webm",
  ".wav",
  ".flac",
  ".ogg",
  ".ttf",
  ".woff",
  ".woff2",
  ".eot",
  ".otf",
  ".sqlite",
  ".db",
  ".lock",
]);

/**
 * Manages file path indexing and glob queries.
 */
export class PathIndexer {
  private database: IndexDatabase;
  private projectRoot: string;
  private gitignore: GitignoreParser | null = null;

  constructor(database: IndexDatabase, projectRoot: string) {
    this.database = database;
    this.projectRoot = projectRoot;
  }

  /**
   * Build or update the file path index.
   * Uses incremental updates when possible.
   */
  async buildIndex(
    options: { full?: boolean; signal?: AbortSignal } = {},
  ): Promise<IndexResult> {
    const start = Date.now();
    const db = await this.database.getDb();

    // Load gitignore rules
    this.gitignore = await createGitignoreParser(this.projectRoot);

    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesRemoved = 0;

    // Get existing files for incremental update
    const existingFiles = new Map<string, { id: number; mtime: number }>();
    if (!options.full) {
      const rows = db.prepare("SELECT id, path, mtime FROM files").all<
        { id: number; path: string; mtime: number }
      >();
      for (const row of rows) {
        existingFiles.set(row.path, { id: row.id, mtime: row.mtime });
      }
    }

    // Track seen paths for removal detection
    const seenPaths = new Set<string>();

    // Prepare statements
    const insertStmt = db.prepare(`
      INSERT INTO files (path, name, extension, directory, mtime, size, indexed_at, is_binary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
      UPDATE files SET mtime = ?, size = ?, indexed_at = ?, is_binary = ?
      WHERE id = ?
    `);

    this.database.beginTransaction();

    try {
      // Walk the filesystem
      for await (
        const entry of walk(this.projectRoot, {
          includeDirs: false,
          followSymlinks: false,
        })
      ) {
        if (options.signal?.aborted) break;

        // Get relative path
        const relativePath = relative(this.projectRoot, entry.path);

        // Check gitignore
        if (this.gitignore?.shouldIgnore(relativePath, false)) {
          filesSkipped++;
          continue;
        }

        // Quick component check for common ignores
        const pathParts = relativePath.split("/");
        let shouldSkip = false;
        for (const part of pathParts) {
          if (this.gitignore?.shouldIgnoreComponent(part, true)) {
            shouldSkip = true;
            break;
          }
        }
        if (shouldSkip) {
          filesSkipped++;
          continue;
        }

        seenPaths.add(relativePath);

        // Get file stats
        let stat: Deno.FileInfo;
        try {
          stat = await Deno.stat(entry.path);
        } catch {
          filesSkipped++;
          continue;
        }

        const mtime = Math.floor((stat.mtime?.getTime() ?? Date.now()) / 1000);
        const size = stat.size;
        const name = basename(relativePath);
        const ext = extname(name).toLowerCase() || null;
        const dir = dirname(relativePath);
        const isBinary = ext ? BINARY_EXTENSIONS.has(ext) : false;
        const now = Math.floor(Date.now() / 1000);

        // Check if file needs update
        const existing = existingFiles.get(relativePath);
        if (existing) {
          if (existing.mtime !== mtime) {
            // File modified - update
            updateStmt.run(mtime, size, now, isBinary ? 1 : 0, existing.id);
            filesIndexed++;
          } else {
            filesSkipped++;
          }
        } else {
          // New file - insert
          insertStmt.run(
            relativePath,
            name,
            ext,
            dir,
            mtime,
            size,
            now,
            isBinary ? 1 : 0,
          );
          filesIndexed++;
        }
      }

      // Remove deleted files
      if (!options.full && existingFiles.size > 0) {
        const deleteStmt = db.prepare("DELETE FROM files WHERE id = ?");
        for (const [path, { id }] of existingFiles) {
          if (!seenPaths.has(path)) {
            deleteStmt.run(id);
            filesRemoved++;
          }
        }
      }

      this.database.commit();
    } catch (error) {
      this.database.rollback();
      throw error;
    }

    return {
      filesIndexed,
      filesSkipped,
      filesRemoved,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Query files matching a glob pattern.
   * Much faster than filesystem walk for indexed projects.
   */
  async queryGlob(
    pattern: string,
    searchPath?: string,
    options: GlobQueryOptions = {},
  ): Promise<string[]> {
    const db = await this.database.getDb();
    const limit = options.limit ?? 100;

    // Normalize search path
    const relativeSearchPath = searchPath
      ? relative(this.projectRoot, resolve(this.projectRoot, searchPath))
      : "";

    // Convert glob to regex
    const regex = globToRegExp(pattern, {
      extended: true,
      globstar: true,
    });

    // Build SQL query with optimizations
    let sql = "SELECT path FROM files WHERE 1=1";
    const params: (string | number)[] = [];

    // Add path prefix filter if searching in subdirectory
    if (relativeSearchPath) {
      sql += " AND (directory = ? OR directory LIKE ?)";
      params.push(relativeSearchPath, `${relativeSearchPath}/%`);
    }

    // Exclude binary files unless requested
    if (!options.includeBinary) {
      sql += " AND is_binary = 0";
    }

    // Order by modification time (most recent first)
    sql += " ORDER BY mtime DESC";

    // Fetch candidates and filter by regex
    const results: string[] = [];
    const rows = db.prepare(sql).all<{ path: string }>(...params);

    for (const row of rows) {
      // Match against relative path from search root
      const matchPath = relativeSearchPath
        ? relative(relativeSearchPath, row.path)
        : row.path;

      if (regex.test(matchPath) || regex.test(basename(row.path))) {
        // Return absolute path
        results.push(resolve(this.projectRoot, row.path));
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /**
   * Get files in a directory (non-recursive).
   */
  async listDirectory(dirPath: string): Promise<FileEntry[]> {
    const db = await this.database.getDb();
    const relativePath = relative(this.projectRoot, dirPath);

    const rows = db.prepare(`
      SELECT id, path, name, extension, directory, mtime, size, indexed_at, is_binary
      FROM files
      WHERE directory = ?
      ORDER BY name
    `).all<{
      id: number;
      path: string;
      name: string;
      extension: string | null;
      directory: string;
      mtime: number;
      size: number;
      indexed_at: number;
      is_binary: number;
    }>(relativePath || ".");

    return rows.map((row) => ({
      id: row.id,
      path: resolve(this.projectRoot, row.path),
      name: row.name,
      extension: row.extension,
      directory: row.directory,
      mtime: row.mtime,
      size: row.size,
      indexedAt: row.indexed_at,
      isBinary: row.is_binary === 1,
    }));
  }

  /**
   * Search files by name (partial match).
   */
  async searchByName(
    query: string,
    options: GlobQueryOptions = {},
  ): Promise<string[]> {
    const db = await this.database.getDb();
    const limit = options.limit ?? 100;

    let sql = "SELECT path FROM files WHERE name LIKE ?";
    const params: (string | number)[] = [`%${query}%`];

    if (!options.includeBinary) {
      sql += " AND is_binary = 0";
    }

    sql += " ORDER BY mtime DESC LIMIT ?";
    params.push(limit);

    const rows = db.prepare(sql).all<{ path: string }>(...params);
    return rows.map((row) => resolve(this.projectRoot, row.path));
  }

  /**
   * Search files by extension.
   */
  async searchByExtension(
    extension: string,
    options: GlobQueryOptions = {},
  ): Promise<string[]> {
    const db = await this.database.getDb();
    const limit = options.limit ?? 100;

    // Normalize extension
    const ext = extension.startsWith(".") ? extension : `.${extension}`;

    const sql = `
      SELECT path FROM files
      WHERE extension = ?
      ORDER BY mtime DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all<{ path: string }>(
      ext.toLowerCase(),
      limit,
    );
    return rows.map((row) => resolve(this.projectRoot, row.path));
  }

  /**
   * Get file entry by path.
   */
  async getFile(filePath: string): Promise<FileEntry | null> {
    const db = await this.database.getDb();
    const relativePath = relative(this.projectRoot, filePath);

    const row = db.prepare(`
      SELECT id, path, name, extension, directory, mtime, size, indexed_at, is_binary
      FROM files WHERE path = ?
    `).get<{
      id: number;
      path: string;
      name: string;
      extension: string | null;
      directory: string;
      mtime: number;
      size: number;
      indexed_at: number;
      is_binary: number;
    }>(relativePath);

    if (!row) return null;

    return {
      id: row.id,
      path: resolve(this.projectRoot, row.path),
      name: row.name,
      extension: row.extension,
      directory: row.directory,
      mtime: row.mtime,
      size: row.size,
      indexedAt: row.indexed_at,
      isBinary: row.is_binary === 1,
    };
  }

  /**
   * Check if a file has been modified since last index.
   */
  async isFileStale(filePath: string): Promise<boolean> {
    const entry = await this.getFile(filePath);
    if (!entry) return true;

    try {
      const stat = await Deno.stat(filePath);
      const mtime = Math.floor((stat.mtime?.getTime() ?? Date.now()) / 1000);
      return mtime !== entry.mtime;
    } catch {
      return true;
    }
  }

  /**
   * Remove a file from the index.
   */
  async removeFile(filePath: string): Promise<void> {
    const db = await this.database.getDb();
    const relativePath = relative(this.projectRoot, filePath);
    db.prepare("DELETE FROM files WHERE path = ?").run(relativePath);
  }

  /**
   * Get total file count in index.
   */
  async getFileCount(): Promise<number> {
    const db = await this.database.getDb();
    const row = db.prepare("SELECT COUNT(*) as count FROM files").get<
      { count: number }
    >();
    return row?.count ?? 0;
  }
}
