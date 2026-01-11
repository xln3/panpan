/**
 * Logger tools module - LLM-callable tools for log management
 *
 * Provides tools for:
 * - LoggerConfig: Set logging verbosity level
 * - LoggerQuery: Query and analyze logs
 * - LoggerExport: Export logs to file
 * - LoggerClear: Clear all logs
 *
 * @example
 * ```typescript
 * // Set log level to capture LLM interactions
 * LoggerConfig({ level: "llm" })
 *
 * // Get operation summary
 * LoggerQuery({ format: "summary" })
 *
 * // Analyze failures
 * LoggerQuery({ format: "failures" })
 *
 * // Export to markdown
 * LoggerExport({ format: "markdown", path: "./logs/session.md" })
 * ```
 */

export { LoggerConfigTool } from "./logger-config.ts";
export { LoggerQueryTool } from "./logger-query.ts";
export { LoggerExportTool, LoggerClearTool } from "./logger-export.ts";
