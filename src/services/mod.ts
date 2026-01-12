/**
 * Services module - unified entry point for all services.
 *
 * This module provides:
 * - Re-exports of all service singletons
 * - Unified initialization and cleanup functions
 *
 * @example
 * ```typescript
 * import { initializeServices, cleanupServices } from "./services/mod.ts";
 *
 * // Initialize all services at startup
 * initializeServices({ logLevel: "tool" });
 *
 * // Cleanup at shutdown
 * await cleanupServices();
 * ```
 */

import type { LogLevel } from "../types/logger.ts";

// === Service singleton re-exports ===

// Logger service
export { loggerService, LoggerService } from "./logger/mod.ts";

// Remote connection service
export { connectionManager, ConnectionManager } from "./remote/mod.ts";

// Watcher service
export { monitorRegistry, MonitorRegistry, alertManager, AlertManager } from "./watcher/mod.ts";

// System reminder service
export { systemReminderService, emitReminderEvent, getReminderContents } from "./system-reminder.ts";

// === Service initialization config ===

export interface ServicesConfig {
  /** Log level for the logger service */
  logLevel?: LogLevel;
  /** Path for persistent log storage */
  logPersistPath?: string;
}

// === Lifecycle functions ===

// Import singletons at module level (safe - no circular deps from services/)
import { loggerService } from "./logger/mod.ts";
import { connectionManager } from "./remote/mod.ts";
import { monitorRegistry } from "./watcher/mod.ts";
import { systemReminderService } from "./system-reminder.ts";

/**
 * Initialize all services with optional configuration.
 * Should be called at application startup.
 */
export function initializeServices(config: ServicesConfig = {}): void {
  // 1. Initialize Logger first (other services may depend on it)
  loggerService.initialize({
    defaultLevel: config.logLevel || "tool",
    persistPath: config.logPersistPath,
  });

  // 2. Register built-in monitors
  monitorRegistry.registerBuiltinMonitors();

  // 3. Reset system reminder service
  systemReminderService.resetSession();
}

/**
 * Cleanup all services.
 * Should be called at application shutdown.
 */
export async function cleanupServices(): Promise<void> {
  // 1. Disconnect all remote connections
  await connectionManager.disconnectAll();

  // 2. Clear monitor registry (monitors are stateless samplers, not running services)
  monitorRegistry.clear();

  // 3. Flush and shutdown logger
  await loggerService.shutdown();
}
