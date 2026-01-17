/**
 * Vector indexer for semantic/embedding-based search.
 *
 * Stores document embeddings in SQLite and performs similarity search
 * using cosine similarity. Supports chunking large files for better
 * semantic matching.
 */

import { resolve } from "@std/path";
import type { IndexDatabase, IndexResult } from "./database.ts";
import {
  cosineSimilarity,
  createEmbeddingProvider,
  deserializeEmbedding,
  type EmbeddingConfig,
  type EmbeddingProvider,
  serializeEmbedding,
} from "./embeddings/mod.ts";

/** Options for vector search */
export interface VectorSearchOptions {
  /** Maximum results to return */
  limit?: number;
  /** Minimum similarity score (0-1) */
  minScore?: number;
}

/** Vector search result */
export interface VectorMatch {
  filePath: string;
  /** Similarity score (0-1, higher is more similar) */
  score: number;
  /** Matched chunk text */
  chunkText?: string;
  /** Start position in file */
  chunkStart?: number;
  /** End position in file */
  chunkEnd?: number;
}

/** Result of vector indexing operation */
export interface VectorIndexResult extends IndexResult {
  /** Number of chunks indexed */
  chunksIndexed: number;
}

/**
 * Default chunk size in characters.
 * Balance between context and embedding quality.
 */
const DEFAULT_CHUNK_SIZE = 512;

/**
 * Overlap between chunks to preserve context at boundaries.
 */
const DEFAULT_CHUNK_OVERLAP = 64;

/**
 * Manages vector embeddings for semantic search.
 */
export class VectorIndexer {
  private database: IndexDatabase;
  private projectRoot: string;
  private provider: EmbeddingProvider | null = null;
  private embeddingConfig: Partial<EmbeddingConfig>;

  constructor(
    database: IndexDatabase,
    projectRoot: string,
    embeddingConfig: Partial<EmbeddingConfig> = {},
  ) {
    this.database = database;
    this.projectRoot = projectRoot;
    this.embeddingConfig = embeddingConfig;
  }

  /**
   * Initialize the embedding provider.
   * This is separate from constructor because it may download models.
   */
  async initialize(): Promise<void> {
    if (!this.provider) {
      this.provider = await createEmbeddingProvider(this.embeddingConfig);
    }
  }

  /**
   * Check if the indexer is ready (provider initialized).
   */
  isReady(): boolean {
    return this.provider?.isReady() ?? false;
  }

  /**
   * Build vector index for files.
   * Chunks files and generates embeddings for each chunk.
   */
  async buildVectorIndex(
    options: {
      full?: boolean;
      signal?: AbortSignal;
      chunkSize?: number;
      chunkOverlap?: number;
    } = {},
  ): Promise<VectorIndexResult> {
    const start = Date.now();

    if (!this.provider) {
      await this.initialize();
    }

    const db = await this.database.getDb();
    const config = this.database.getConfig();

    if (!config.enableVectors) {
      return {
        filesIndexed: 0,
        filesSkipped: 0,
        filesRemoved: 0,
        chunksIndexed: 0,
        durationMs: Date.now() - start,
      };
    }

    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

    let filesIndexed = 0;
    let filesSkipped = 0;
    let chunksIndexed = 0;

    // Get files that need vector indexing
    const query = options.full
      ? `
        SELECT f.id, f.path, f.size
        FROM files f
        WHERE f.is_binary = 0 AND f.size <= ?
      `
      : `
        SELECT f.id, f.path, f.size
        FROM files f
        LEFT JOIN file_vectors fv ON f.id = fv.file_id
        WHERE f.is_binary = 0 AND f.size <= ? AND fv.file_id IS NULL
        GROUP BY f.id
      `;

    const files = db.prepare(query).all<{
      id: number;
      path: string;
      size: number;
    }>(config.maxFileSize);

    // Prepare statements
    const insertVector = db.prepare(`
      INSERT INTO file_vectors (file_id, chunk_start, chunk_end, chunk_text, embedding)
      VALUES (?, ?, ?, ?, ?)
    `);

    const deleteVectors = db.prepare(`
      DELETE FROM file_vectors WHERE file_id = ?
    `);

    this.database.beginTransaction();

    try {
      for (const file of files) {
        if (options.signal?.aborted) break;

        const fullPath = resolve(this.projectRoot, file.path);

        try {
          // Read file content
          const content = await Deno.readTextFile(fullPath);

          // Skip if binary content
          if (this.isBinaryContent(content)) {
            filesSkipped++;
            continue;
          }

          // Delete existing vectors if doing full rebuild
          if (options.full) {
            deleteVectors.run(file.id);
          }

          // Chunk the content
          const chunks = this.chunkText(content, chunkSize, chunkOverlap);

          // Generate embeddings for all chunks
          const embeddings = await this.provider!.embedBatch(
            chunks.map((c) => c.text),
          );

          // Store embeddings
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const embedding = embeddings[i];

            insertVector.run(
              file.id,
              chunk.start,
              chunk.end,
              chunk.text,
              serializeEmbedding(embedding),
            );
            chunksIndexed++;
          }

          filesIndexed++;
        } catch {
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
      chunksIndexed,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Search for semantically similar content.
   */
  async search(
    query: string,
    options: VectorSearchOptions = {},
  ): Promise<VectorMatch[]> {
    if (!this.provider) {
      await this.initialize();
    }

    const db = await this.database.getDb();
    const config = this.database.getConfig();

    if (!config.enableVectors) {
      throw new Error("Vector search is not enabled in index configuration");
    }

    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.5;

    // Generate query embedding
    const queryEmbedding = await this.provider!.embed(query);

    // Get all vectors and compute similarity
    // Note: For large indexes, this could be optimized with approximate nearest neighbors
    const rows = db.prepare(`
      SELECT fv.id, fv.file_id, fv.chunk_start, fv.chunk_end, fv.chunk_text, fv.embedding,
             f.path
      FROM file_vectors fv
      JOIN files f ON fv.file_id = f.id
    `).all<{
      id: number;
      file_id: number;
      chunk_start: number;
      chunk_end: number;
      chunk_text: string;
      embedding: Uint8Array;
      path: string;
    }>();

    // Compute similarities
    const scored: Array<VectorMatch & { id: number }> = [];

    for (const row of rows) {
      const embedding = deserializeEmbedding(row.embedding);
      const score = cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        scored.push({
          filePath: resolve(this.projectRoot, row.path),
          score,
          chunkText: row.chunk_text,
          chunkStart: row.chunk_start,
          chunkEnd: row.chunk_end,
          id: row.id,
        });
      }
    }

    // Sort by score descending and take top results
    scored.sort((a, b) => b.score - a.score);

    // Remove duplicates (same file), keeping best score
    const seenFiles = new Set<string>();
    const results: VectorMatch[] = [];

    for (const match of scored) {
      if (results.length >= limit) break;

      if (!seenFiles.has(match.filePath)) {
        seenFiles.add(match.filePath);
        results.push({
          filePath: match.filePath,
          score: match.score,
          chunkText: match.chunkText,
          chunkStart: match.chunkStart,
          chunkEnd: match.chunkEnd,
        });
      }
    }

    return results;
  }

  /**
   * Get number of chunks indexed.
   */
  async getIndexedChunkCount(): Promise<number> {
    const db = await this.database.getDb();
    const row = db.prepare("SELECT COUNT(*) as count FROM file_vectors").get<
      { count: number }
    >();
    return row?.count ?? 0;
  }

  /**
   * Remove vectors for a file.
   */
  async removeVectors(fileId: number): Promise<void> {
    const db = await this.database.getDb();
    db.prepare("DELETE FROM file_vectors WHERE file_id = ?").run(fileId);
  }

  /**
   * Clear all vectors.
   */
  async clearVectors(): Promise<void> {
    const db = await this.database.getDb();
    db.exec("DELETE FROM file_vectors");
  }

  /**
   * Dispose the embedding provider.
   */
  dispose(): void {
    this.provider?.dispose();
    this.provider = null;
  }

  /**
   * Chunk text into overlapping segments.
   */
  private chunkText(
    text: string,
    chunkSize: number,
    overlap: number,
  ): Array<{ text: string; start: number; end: number }> {
    const chunks: Array<{ text: string; start: number; end: number }> = [];

    if (text.length <= chunkSize) {
      return [{ text, start: 0, end: text.length }];
    }

    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push({
        text: text.substring(start, end),
        start,
        end,
      });

      // Move to next chunk with overlap
      start = end - overlap;

      // Avoid infinite loop for small overlaps
      if (start >= text.length - overlap) break;
    }

    return chunks;
  }

  /**
   * Check if content appears to be binary.
   */
  private isBinaryContent(content: string): boolean {
    const sample = content.substring(0, 8192);
    if (sample.includes("\0")) return true;

    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        nonPrintable++;
      }
    }

    return nonPrintable / sample.length > 0.1;
  }
}
