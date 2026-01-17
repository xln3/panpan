/**
 * Search Index Service - Fast code search with SQLite backing.
 *
 * Provides three search acceleration capabilities:
 * 1. Path indexing - Fast glob pattern matching
 * 2. FTS5 full-text search - Fast content search
 * 3. Vector search - Semantic/natural language queries (optional)
 *
 * @example
 * ```typescript
 * import { searchIndexService, initSearchIndex } from "./services/search-index/mod.ts";
 *
 * // Initialize at startup
 * await initSearchIndex("/path/to/project");
 *
 * // Use glob with index acceleration
 * const files = await searchIndexService.glob("**\/*.ts");
 *
 * // Use FTS5 for content search
 * const matches = await searchIndexService.search("function handleError");
 * ```
 */

// Internal imports for use within this module
import { IndexDatabase } from "./database.ts";
import { PathIndexer } from "./path-indexer.ts";
import { ContentIndexer } from "./content-indexer.ts";
import { VectorIndexer } from "./vector-indexer.ts";

// Re-exports
export { DEFAULT_CONFIG, IndexDatabase } from "./database.ts";
export type { IndexConfig, IndexResult, IndexStats } from "./database.ts";

export { createGitignoreParser, GitignoreParser } from "./gitignore-parser.ts";

export { PathIndexer } from "./path-indexer.ts";
export type { FileEntry, GlobQueryOptions } from "./path-indexer.ts";

export { ContentIndexer } from "./content-indexer.ts";
export type {
  ContentIndexResult,
  ContentMatch,
  ContentSearchOptions,
} from "./content-indexer.ts";

export { VectorIndexer } from "./vector-indexer.ts";
export type {
  VectorIndexResult,
  VectorMatch,
  VectorSearchOptions,
} from "./vector-indexer.ts";

export type { EmbeddingConfig, EmbeddingProvider } from "./embeddings/mod.ts";

// Service singleton will be initialized lazily
let _service: SearchIndexService | null = null;

/**
 * Main search index service providing unified access to all search capabilities.
 */
export class SearchIndexService {
  private database: IndexDatabase;
  private pathIndexer: PathIndexer;
  private contentIndexer: ContentIndexer;
  private vectorIndexer: VectorIndexer | null = null;
  private projectRoot: string;
  private initialized = false;

  constructor(
    projectRoot: string,
    config?: Partial<import("./database.ts").IndexConfig>,
  ) {
    this.projectRoot = projectRoot;
    this.database = new IndexDatabase(projectRoot, config);
    this.pathIndexer = new PathIndexer(this.database, projectRoot);
    this.contentIndexer = new ContentIndexer(this.database, projectRoot);

    // Only create vector indexer if vectors are enabled
    if (config?.enableVectors) {
      this.vectorIndexer = new VectorIndexer(this.database, projectRoot, {
        provider: config.embeddingModel === "openai" ? "openai" : "local",
      });
    }
  }

  /** Initialize the service and build/update index */
  async initialize(
    options: { rebuild?: boolean; indexContent?: boolean } = {},
  ): Promise<import("./database.ts").IndexResult> {
    await this.database.open();

    // Build or update the path index
    const result = await this.pathIndexer.buildIndex({ full: options.rebuild });

    // Optionally build content index (can be slow for large codebases)
    if (options.indexContent !== false && this.database.getConfig().enableFts) {
      await this.contentIndexer.buildContentIndex({ full: options.rebuild });
    }

    this.initialized = true;

    return result;
  }

  /** Check if service is initialized */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Check if index exists on disk */
  async indexExists(): Promise<boolean> {
    return await this.database.exists();
  }

  /** Get index statistics */
  async getStats(): Promise<import("./database.ts").IndexStats> {
    return await this.database.getStats();
  }

  /** Get database configuration */
  getConfig(): import("./database.ts").IndexConfig {
    return this.database.getConfig();
  }

  /**
   * Query files using glob pattern.
   * Falls back to filesystem walk if index is not available.
   */
  async glob(
    pattern: string,
    searchPath?: string,
    options?: import("./path-indexer.ts").GlobQueryOptions,
  ): Promise<string[]> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.pathIndexer.queryGlob(pattern, searchPath, options);
  }

  /**
   * Search files by name (partial match).
   */
  async searchByName(
    query: string,
    options?: import("./path-indexer.ts").GlobQueryOptions,
  ): Promise<string[]> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.pathIndexer.searchByName(query, options);
  }

  /**
   * Search files by extension.
   */
  async searchByExtension(
    extension: string,
    options?: import("./path-indexer.ts").GlobQueryOptions,
  ): Promise<string[]> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.pathIndexer.searchByExtension(extension, options);
  }

  /**
   * List files in a directory.
   */
  async listDirectory(
    dirPath: string,
  ): Promise<import("./path-indexer.ts").FileEntry[]> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.pathIndexer.listDirectory(dirPath);
  }

  /**
   * Get file entry by path.
   */
  async getFile(
    filePath: string,
  ): Promise<import("./path-indexer.ts").FileEntry | null> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.pathIndexer.getFile(filePath);
  }

  /**
   * Check if a file has been modified since last index.
   */
  async isFileStale(filePath: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.pathIndexer.isFileStale(filePath);
  }

  /**
   * Get total file count in index.
   */
  async getFileCount(): Promise<number> {
    if (!this.initialized) {
      return 0;
    }
    return await this.pathIndexer.getFileCount();
  }

  /**
   * Rebuild the entire index from scratch.
   */
  async rebuild(): Promise<import("./database.ts").IndexResult> {
    return await this.pathIndexer.buildIndex({ full: true });
  }

  /**
   * Update index incrementally (only changed files).
   */
  async update(): Promise<import("./database.ts").IndexResult> {
    return await this.pathIndexer.buildIndex({ full: false });
  }

  /**
   * Delete the index completely.
   */
  async deleteIndex(): Promise<void> {
    await this.database.deleteIndex();
    this.initialized = false;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.database.close();
    this.initialized = false;
  }

  /**
   * Get the project root path.
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Get the underlying database instance (for advanced use).
   */
  getDatabase(): IndexDatabase {
    return this.database;
  }

  /**
   * Get the path indexer instance (for advanced use).
   */
  getPathIndexer(): PathIndexer {
    return this.pathIndexer;
  }

  /**
   * Get the content indexer instance (for advanced use).
   */
  getContentIndexer(): ContentIndexer {
    return this.contentIndexer;
  }

  // === Content Search Methods ===

  /**
   * Search file contents using FTS5.
   * Supports FTS5 query syntax: phrases, boolean operators, prefix matching.
   */
  async search(
    query: string,
    options?: import("./content-indexer.ts").ContentSearchOptions,
  ): Promise<import("./content-indexer.ts").ContentMatch[]> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.contentIndexer.search(query, options);
  }

  /**
   * Search for literal string (no FTS5 operators).
   */
  async searchLiteral(
    query: string,
    options?: import("./content-indexer.ts").ContentSearchOptions,
  ): Promise<import("./content-indexer.ts").ContentMatch[]> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.contentIndexer.searchLiteral(query, options);
  }

  /**
   * Search with regex pattern.
   */
  async searchRegex(
    pattern: string,
    options?: import("./content-indexer.ts").ContentSearchOptions,
  ): Promise<import("./content-indexer.ts").ContentMatch[]> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.contentIndexer.searchRegex(pattern, options);
  }

  /**
   * Build or update the content index.
   */
  async buildContentIndex(
    options?: { full?: boolean },
  ): Promise<import("./content-indexer.ts").ContentIndexResult> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    return await this.contentIndexer.buildContentIndex(options);
  }

  /**
   * Get number of files with content indexed.
   */
  async getContentIndexedCount(): Promise<number> {
    if (!this.initialized) {
      return 0;
    }
    return await this.contentIndexer.getIndexedCount();
  }

  // === Vector Search Methods ===

  /**
   * Get the vector indexer instance (for advanced use).
   * Returns null if vector indexing is not enabled.
   */
  getVectorIndexer(): VectorIndexer | null {
    return this.vectorIndexer;
  }

  /**
   * Check if vector search is available.
   */
  isVectorSearchAvailable(): boolean {
    return this.vectorIndexer !== null &&
      this.database.getConfig().enableVectors;
  }

  /**
   * Search using natural language (semantic search).
   * Requires vector indexing to be enabled.
   */
  async semanticSearch(
    query: string,
    options?: import("./vector-indexer.ts").VectorSearchOptions,
  ): Promise<import("./vector-indexer.ts").VectorMatch[]> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    if (!this.vectorIndexer) {
      throw new Error(
        "Vector search is not enabled. Set enableVectors: true in config.",
      );
    }
    return await this.vectorIndexer.search(query, options);
  }

  /**
   * Build or update the vector index.
   * This is a separate operation because it can be slow (requires generating embeddings).
   */
  async buildVectorIndex(
    options?: { full?: boolean },
  ): Promise<import("./vector-indexer.ts").VectorIndexResult> {
    if (!this.initialized) {
      throw new Error("Search index not initialized. Call initialize() first.");
    }
    if (!this.vectorIndexer) {
      throw new Error(
        "Vector search is not enabled. Set enableVectors: true in config.",
      );
    }
    return await this.vectorIndexer.buildVectorIndex(options);
  }

  /**
   * Get number of chunks with vector embeddings.
   */
  async getVectorIndexedCount(): Promise<number> {
    if (!this.initialized || !this.vectorIndexer) {
      return 0;
    }
    return await this.vectorIndexer.getIndexedChunkCount();
  }
}

/**
 * Get the search index service singleton.
 * Returns null if not initialized.
 */
export function getSearchIndexService(): SearchIndexService | null {
  return _service;
}

/**
 * Initialize the search index service for a project.
 * This should be called once at application startup.
 */
export async function initSearchIndex(
  projectRoot: string,
  options: {
    config?: Partial<import("./database.ts").IndexConfig>;
    rebuild?: boolean;
  } = {},
): Promise<SearchIndexService> {
  // Close existing service if any
  if (_service) {
    _service.close();
  }

  _service = new SearchIndexService(projectRoot, options.config);
  await _service.initialize({ rebuild: options.rebuild });

  return _service;
}

/**
 * Shutdown the search index service.
 */
export function shutdownSearchIndex(): void {
  if (_service) {
    _service.close();
    _service = null;
  }
}

/**
 * Convenience export for the service singleton.
 * Will throw if accessed before initialization.
 */
export const searchIndexService = {
  get instance(): SearchIndexService {
    if (!_service) {
      throw new Error(
        "Search index not initialized. Call initSearchIndex() first.",
      );
    }
    return _service;
  },
};
