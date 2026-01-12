/**
 * Logger service - main entry point for the logging system.
 * Provides a unified API for logging, querying, and analysis.
 */

import type {
  FailurePoint,
  LogEntry,
  LoggerHooks,
  LogLevel,
} from "../../types/logger.ts";
import { LogStorage, type LogStorageConfig } from "./log-storage.ts";
import { createLoggerHooks } from "./hooks.ts";
import {
  generateOneLiner,
  generateSummary,
  generateTimeline,
} from "./summarizer.ts";
import {
  analyzeFailures,
  findAlternativeRoutes,
  getFailureSummary,
} from "./failure-analyzer.ts";

/**
 * Logger service configuration
 */
export interface LoggerServiceConfig extends Partial<LogStorageConfig> {
  /** Default log level */
  defaultLevel?: LogLevel;
}

/**
 * Main logger service - manages logging, querying, and analysis.
 * Use the singleton instance `loggerService` for most cases.
 */
export class LoggerService {
  private storage: LogStorage;
  private hooks: LoggerHooks;
  private currentLevel: LogLevel = "tool";
  private initialized = false;

  constructor() {
    this.storage = new LogStorage();
    this.hooks = createLoggerHooks(this.storage, () => this.currentLevel);
  }

  /**
   * Initialize the service with optional configuration
   */
  initialize(config: LoggerServiceConfig = {}): void {
    if (this.initialized) return;

    this.storage = new LogStorage(config);
    this.hooks = createLoggerHooks(this.storage, () => this.currentLevel);

    if (config.defaultLevel) {
      this.currentLevel = config.defaultLevel;
    }

    this.initialized = true;
  }

  /**
   * Get hooks for injection into core execution loop
   */
  getHooks(): LoggerHooks {
    return this.hooks;
  }

  /**
   * Set the current log level
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * Query log entries with filters
   */
  query(options: {
    level?: LogLevel;
    type?: string;
    since?: number;
    limit?: number;
    failuresOnly?: boolean;
  } = {}): LogEntry[] {
    return this.storage.query(options);
  }

  /**
   * Get all log entries
   */
  getAll(): LogEntry[] {
    return this.storage.getAll();
  }

  /**
   * Get the number of log entries
   */
  size(): number {
    return this.storage.size();
  }

  /**
   * Generate operation summary
   */
  getSummary(): string {
    return generateSummary(this.storage.getAll());
  }

  /**
   * Generate timeline view
   */
  getTimeline(): string {
    return generateTimeline(this.storage.getAll());
  }

  /**
   * Generate one-line summary
   */
  getOneLiner(): string {
    return generateOneLiner(this.storage.getAll());
  }

  /**
   * Analyze failures in the log
   */
  analyzeFailures(): FailurePoint[] {
    return analyzeFailures(this.storage.getAll());
  }

  /**
   * Get failure summary suitable for display
   */
  getFailureSummary(): string {
    const failures = this.analyzeFailures();
    return getFailureSummary(failures);
  }

  /**
   * Get alternative route suggestions based on failures
   */
  getAlternativeRoutes(): string[] {
    const failures = this.analyzeFailures();
    return findAlternativeRoutes(failures, this.storage.getAll());
  }

  /**
   * Export logs in specified format
   */
  export(format: "json" | "markdown"): string {
    if (format === "json") {
      return this.storage.exportJSON();
    }
    return this.storage.exportMarkdown();
  }

  /**
   * Clear all log entries
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * Flush logs to disk (if persistence is configured)
   */
  async flush(): Promise<void> {
    await this.storage.flush();
  }

  /**
   * Load logs from disk (if persistence is configured)
   */
  async load(): Promise<void> {
    await this.storage.load();
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.storage.stopAutoFlush();
    await this.storage.flush();
  }

  /**
   * Reset service state (useful for testing)
   */
  reset(): void {
    this.storage.clear();
    this.currentLevel = "tool";
    this.initialized = false;
  }
}

/**
 * Singleton logger service instance
 */
export const loggerService = new LoggerService();
