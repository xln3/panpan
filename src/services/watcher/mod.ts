/**
 * Watcher service module for resource monitoring.
 *
 * Provides a plugin-based monitoring architecture for GPU, CPU, Memory, Disk,
 * and Network resources. Supports both local and remote monitoring through
 * the getCommand() + parseOutput() pattern.
 *
 * Main exports:
 * - `monitorRegistry` - Singleton registry for managing monitor instances
 * - `alertManager` - Singleton manager for alert configurations and triggers
 * - Individual monitor classes for custom instantiation
 *
 * @example
 * ```typescript
 * import { monitorRegistry, alertManager } from "./services/watcher/mod.ts";
 *
 * // Register built-in monitors
 * monitorRegistry.registerBuiltinMonitors();
 *
 * // Get available monitors
 * const available = await monitorRegistry.getAvailable();
 * console.log(`Available monitors: ${available.length}`);
 *
 * // Sample CPU
 * const cpuMonitor = monitorRegistry.get("cpu");
 * if (cpuMonitor) {
 *   const reading = await cpuMonitor.sample();
 *   console.log(`CPU utilization: ${reading.values.utilization}%`);
 * }
 *
 * // Set up alert
 * alertManager.addConfig({
 *   id: "cpu-high",
 *   monitorId: "cpu-local",
 *   metric: "utilization",
 *   operator: ">",
 *   threshold: 90,
 *   message: "CPU usage too high",
 *   cooldown: 60000,
 * });
 * ```
 */

// Registry and manager singletons
export { MonitorRegistry, monitorRegistry } from "./monitor-registry.ts";
export {
  type AlertListener,
  AlertManager,
  alertManager,
} from "./alert-manager.ts";

// Base class for custom monitors
export { BaseMonitor } from "./monitors/base.ts";

// Built-in monitors
export { GPUMonitor } from "./monitors/gpu.ts";
export { CPUMonitor } from "./monitors/cpu.ts";
export { MemoryMonitor } from "./monitors/memory.ts";
export { DiskMonitor } from "./monitors/disk.ts";
export { NetworkMonitor } from "./monitors/network.ts";
