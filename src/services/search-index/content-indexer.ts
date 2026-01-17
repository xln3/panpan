/**
 * Content indexer for FTS5 full-text search.
 *
 * Maintains a SQLite FTS5 virtual table for fast content search,
 * supporting complex queries, phrase matching, and boolean operators.
 */

import { relative, resolve } from "@std/path";
import type { IndexDatabase, IndexResult } from "./database.ts";

/** Options for content search queries */
export interface ContentSearchOptions {
  /** Maximum results to return */
  limit?: number;
  /** Return file paths only (no content preview) */
  filesOnly?: boolean;
  /** Number of context characters around match */
  snippetLength?: number;
  /** Highlight matches with markers */
  highlight?: boolean;
}

/** Search result with match context */
export interface ContentMatch {
  filePath: string;
  /** Line number of match (1-indexed) */
  line?: number;
  /** Content snippet with match */
  snippet?: string;
  /** Match score from FTS5 */
  score?: number;
}

/** Result of content indexing operation */
export interface ContentIndexResult extends IndexResult {
  /** Number of files with content indexed */
  contentIndexed: number;
}

/**
 * Maximum file size to index content (1MB default).
 * Larger files are skipped for content indexing.
 */
const MAX_CONTENT_SIZE = 1024 * 1024;

/**
 * Manages FTS5 content indexing and search.
 */
export class ContentIndexer {
  private database: IndexDatabase;
  private projectRoot: string;

  constructor(database: IndexDatabase, projectRoot: string) {
    this.database = database;
    this.projectRoot = projectRoot;
  }

  /**
   * Index content for files in the path index.
   * Only indexes text files that haven't been indexed or have changed.
   */
  async buildContentIndex(
    options: { full?: boolean; signal?: AbortSignal } = {},
  ): Promise<ContentIndexResult> {
    const start = Date.now();
    const db = await this.database.getDb();
    const config = this.database.getConfig();

    if (!config.enableFts) {
      return {
        filesIndexed: 0,
        filesSkipped: 0,
        filesRemoved: 0,
        contentIndexed: 0,
        durationMs: Date.now() - start,
      };
    }

    let filesIndexed = 0;
    let filesSkipped = 0;
    let contentIndexed = 0;

    // Get files that need content indexing
    // Join with file_content to find unindexed or stale files
    const query = options.full
      ? `
        SELECT f.id, f.path, f.mtime, f.size, f.is_binary
        FROM files f
        WHERE f.is_binary = 0 AND f.size <= ?
      `
      : `
        SELECT f.id, f.path, f.mtime, f.size, f.is_binary
        FROM files f
        LEFT JOIN file_content fc ON f.id = fc.file_id
        WHERE f.is_binary = 0 AND f.size <= ? AND fc.file_id IS NULL
      `;

    const files = db.prepare(query).all<{
      id: number;
      path: string;
      mtime: number;
      size: number;
      is_binary: number;
    }>(config.maxFileSize || MAX_CONTENT_SIZE);

    // Prepare statements
    const insertContent = db.prepare(`
      INSERT INTO file_content (file_id, path, content)
      VALUES (?, ?, ?)
    `);

    const deleteContent = db.prepare(`
      DELETE FROM file_content WHERE file_id = ?
    `);

    this.database.beginTransaction();

    try {
      for (const file of files) {
        if (options.signal?.aborted) break;

        const fullPath = resolve(this.projectRoot, file.path);

        try {
          // Read file content
          const content = await Deno.readTextFile(fullPath);

          // Check if it's actually text (not binary disguised as text)
          if (this.isBinaryContent(content)) {
            filesSkipped++;
            continue;
          }

          // Delete existing content if doing full rebuild
          if (options.full) {
            deleteContent.run(file.id);
          }

          // Insert into FTS5 table
          insertContent.run(file.id, file.path, content);
          contentIndexed++;
          filesIndexed++;
        } catch {
          // File can't be read (permission, doesn't exist, etc.)
          filesSkipped++;
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
      filesRemoved: 0,
      contentIndexed,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Search file contents using FTS5.
   *
   * Supports FTS5 query syntax:
   * - Simple terms: `error`
   * - Phrases: `"error handling"`
   * - Boolean: `error AND warning`, `error OR exception`
   * - Prefix: `hand*`
   * - Negation: `error NOT warning`
   */
  async search(
    query: string,
    options: ContentSearchOptions = {},
  ): Promise<ContentMatch[]> {
    const db = await this.database.getDb();
    const config = this.database.getConfig();

    if (!config.enableFts) {
      throw new Error("FTS5 is not enabled in index configuration");
    }

    const limit = options.limit ?? 100;
    const snippetLength = options.snippetLength ?? 64;

    // Sanitize query for FTS5
    const sanitizedQuery = this.sanitizeFtsQuery(query);

    let sql: string;
    if (options.filesOnly) {
      // Return distinct file paths only
      sql = `
        SELECT DISTINCT path, bm25(file_content) as score
        FROM file_content
        WHERE file_content MATCH ?
        ORDER BY score
        LIMIT ?
      `;
    } else {
      // Return with snippets
      sql = `
        SELECT
          path,
          snippet(file_content, 2, '>>>', '<<<', '...', ?) as snippet,
          bm25(file_content) as score
        FROM file_content
        WHERE file_content MATCH ?
        ORDER BY score
        LIMIT ?
      `;
    }

    const results: ContentMatch[] = [];

    try {
      if (options.filesOnly) {
        const rows = db.prepare(sql).all<{
          path: string;
          score: number;
        }>(sanitizedQuery, limit);

        for (const row of rows) {
          results.push({
            filePath: resolve(this.projectRoot, row.path),
            score: row.score,
          });
        }
      } else {
        const rows = db.prepare(sql).all<{
          path: string;
          snippet: string;
          score: number;
        }>(snippetLength, sanitizedQuery, limit);

        for (const row of rows) {
          // Extract line number from snippet context if possible
          const match: ContentMatch = {
            filePath: resolve(this.projectRoot, row.path),
            snippet: row.snippet,
            score: row.score,
          };

          results.push(match);
        }
      }
    } catch (error) {
      // FTS5 query syntax error - try as literal search
      if (error instanceof Error && error.message.includes("fts5")) {
        return this.searchLiteral(query, options);
      }
      throw error;
    }

    return results;
  }

  /**
   * Search for literal string (escaping FTS5 operators).
   */
  async searchLiteral(
    query: string,
    options: ContentSearchOptions = {},
  ): Promise<ContentMatch[]> {
    // Escape FTS5 special characters and wrap in quotes
    const escaped = `"${query.replace(/"/g, '""')}"`;
    return await this.search(escaped, options);
  }

  /**
   * Search with regex pattern.
   * Falls back to content scan since FTS5 doesn't support regex.
   */
  async searchRegex(
    pattern: string,
    options: ContentSearchOptions = {},
  ): Promise<ContentMatch[]> {
    const db = await this.database.getDb();
    const config = this.database.getConfig();

    if (!config.enableFts) {
      throw new Error("FTS5 is not enabled in index configuration");
    }

    const limit = options.limit ?? 100;
    const regex = new RegExp(pattern, "gi");
    const results: ContentMatch[] = [];

    // Get all indexed content and scan with regex
    // This is slower than FTS5 but necessary for regex support
    const rows = db.prepare(`
      SELECT file_id, path, content
      FROM file_content
    `).all<{ file_id: number; path: string; content: string }>();

    for (const row of rows) {
      if (results.length >= limit) break;

      regex.lastIndex = 0;
      const match = regex.exec(row.content);

      if (match) {
        // Find line number
        const beforeMatch = row.content.substring(0, match.index);
        const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

        // Extract snippet
        const lines = row.content.split("\n");
        const snippet = lines[lineNumber - 1]?.trim() || "";

        results.push({
          filePath: resolve(this.projectRoot, row.path),
          line: lineNumber,
          snippet: snippet.substring(0, 200),
        });
      }
    }

    return results;
  }

  /**
   * Get content-indexed file count.
   */
  async getIndexedCount(): Promise<number> {
    const db = await this.database.getDb();
    const config = this.database.getConfig();

    if (!config.enableFts) {
      return 0;
    }

    const row = db.prepare("SELECT COUNT(*) as count FROM file_content").get<
      { count: number }
    >();
    return row?.count ?? 0;
  }

  /**
   * Remove content for a file.
   */
  async removeContent(filePath: string): Promise<void> {
    const db = await this.database.getDb();
    const relativePath = relative(this.projectRoot, filePath);

    db.prepare("DELETE FROM file_content WHERE path = ?").run(relativePath);
  }

  /**
   * Clear all content from FTS5 table.
   */
  async clearContent(): Promise<void> {
    const db = await this.database.getDb();
    db.exec("DELETE FROM file_content");
  }

  /**
   * Sanitize a query string for FTS5.
   * Handles common user input patterns.
   */
  private sanitizeFtsQuery(query: string): string {
    // Remove problematic characters that break FTS5
    let sanitized = query
      .replace(/[(){}[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // If query looks like a simple search (no operators), treat as OR search
    if (!/\b(AND|OR|NOT)\b/i.test(sanitized) && !sanitized.includes('"')) {
      // Split into tokens and join with OR for broader matching
      const tokens = sanitized.split(/\s+/).filter((t) => t.length > 0);
      if (tokens.length > 1) {
        sanitized = tokens.join(" OR ");
      }
    }

    return sanitized;
  }

  /**
   * Check if content appears to be binary.
   * Looks for null bytes or high ratio of non-printable characters.
   */
  private isBinaryContent(content: string): boolean {
    // Check first 8KB for binary indicators
    const sample = content.substring(0, 8192);

    // Null byte indicates binary
    if (sample.includes("\0")) {
      return true;
    }

    // Count non-printable, non-whitespace characters
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        nonPrintable++;
      }
    }

    // More than 10% non-printable suggests binary
    return nonPrintable / sample.length > 0.1;
  }
}
