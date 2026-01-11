/**
 * Log storage with multi-level query support.
 * Stores log entries and provides filtering by level, type, and time range.
 */

import type {
  LogEntry,
  LogLevel,
  SummaryLogEntry,
  ToolLogEntry,
  LLMLogEntry,
} from "../../types/logger.ts";

/**
 * Configuration for log storage
 */
export interface LogStorageConfig {
  /** Maximum number of entries to keep in memory */
  maxEntries: number;
  /** Optional file path for persistence */
  persistPath?: string;
  /** Whether to auto-flush to disk */
  autoFlush: boolean;
  /** Flush interval in milliseconds */
  flushInterval: number;
}

const DEFAULT_CONFIG: LogStorageConfig = {
  maxEntries: 10000,
  autoFlush: false,
  flushInterval: 30000,
};

/**
 * Log storage with multi-level query support
 */
export class LogStorage {
  private entries: LogEntry[] = [];
  private config: LogStorageConfig;
  private flushTimer?: number;

  constructor(config: Partial<LogStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoFlush && this.config.persistPath) {
      this.startAutoFlush();
    }
  }

  /**
   * Add a log entry
   */
  add(entry: LogEntry): void {
    this.entries.push(entry);

    // Trim old entries when exceeding max
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(-this.config.maxEntries);
    }
  }

  /**
   * Query log entries with filters
   */
  query(options: {
    level?: LogLevel;
    type?: string;
    since?: number;
    until?: number;
    limit?: number;
    failuresOnly?: boolean;
  } = {}): LogEntry[] {
    let results = [...this.entries];

    // Filter by level (include entries at or below the specified level)
    if (options.level) {
      const levelPriority: Record<LogLevel, number> = {
        summary: 0,
        tool: 1,
        llm: 2,
        full: 3,
      };
      const targetPriority = levelPriority[options.level];
      results = results.filter(
        (e) => levelPriority[e.level] <= targetPriority
      );
    }

    // Filter by type
    if (options.type) {
      results = results.filter((e) => e.type === options.type);
    }

    // Filter by time range
    if (options.since) {
      results = results.filter((e) => e.timestamp >= options.since!);
    }
    if (options.until) {
      results = results.filter((e) => e.timestamp <= options.until!);
    }

    // Filter failures only
    if (options.failuresOnly) {
      results = results.filter((e) => !e.success);
    }

    // Limit results (from the end, most recent)
    if (options.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  /**
   * Get summary-level entries
   */
  getSummaries(): SummaryLogEntry[] {
    return this.entries
      .filter((e) => e.level === "summary")
      .map((e) => ({
        timestamp: e.timestamp,
        action: e.type,
        success: e.success,
        duration: e.duration || 0,
      }));
  }

  /**
   * Get tool-level entries
   */
  getToolLogs(): ToolLogEntry[] {
    return this.entries.filter(
      (e) => e.type === "tool_call" || e.type === "tool_result"
    ) as ToolLogEntry[];
  }

  /**
   * Get LLM-level entries
   */
  getLLMLogs(): LLMLogEntry[] {
    return this.entries.filter(
      (e) => e.type === "llm_request" || e.type === "llm_response"
    ) as LLMLogEntry[];
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get all entries (copy)
   */
  getAll(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entry count
   */
  size(): number {
    return this.entries.length;
  }

  /**
   * Persist to file
   */
  async flush(): Promise<void> {
    if (!this.config.persistPath) return;

    const data = JSON.stringify(this.entries, null, 2);
    await Deno.writeTextFile(this.config.persistPath, data);
  }

  /**
   * Load from file
   */
  async load(): Promise<void> {
    if (!this.config.persistPath) return;

    try {
      const data = await Deno.readTextFile(this.config.persistPath);
      this.entries = JSON.parse(data);
    } catch {
      // File doesn't exist or is invalid, start fresh
    }
  }

  /**
   * Start auto-flush timer
   */
  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.config.flushInterval);
  }

  /**
   * Stop auto-flush timer
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * Export as JSON string
   */
  exportJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Export as Markdown
   */
  exportMarkdown(): string {
    const lines: string[] = ["# Operation Log\n"];

    for (const entry of this.entries) {
      const time = new Date(entry.timestamp).toISOString();
      const status = entry.success ? "✓" : "✗";
      lines.push(`## ${status} ${entry.type} (${time})`);
      lines.push(`- Level: ${entry.level}`);
      if (entry.duration) {
        lines.push(`- Duration: ${entry.duration}ms`);
      }
      if (entry.error) {
        lines.push(`- Error: ${entry.error}`);
      }
      lines.push(`\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\``);
      lines.push("");
    }

    return lines.join("\n");
  }
}
