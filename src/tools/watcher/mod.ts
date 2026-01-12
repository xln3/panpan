/**
 * Watcher tools module - LLM-callable tools for resource monitoring
 *
 * Provides tools for:
 * - WatcherStatus: Sample current resource status (CPU, GPU, memory, disk, network)
 * - WatcherList: List available monitors on the system
 * - WatcherAlert: Configure alert rules for threshold monitoring
 *
 * @example
 * ```typescript
 * // Get current resource status
 * WatcherStatus({ monitors: ["cpu", "memory", "gpu"] })
 *
 * // List available monitors
 * WatcherList({})
 *
 * // Add alert for high CPU usage
 * WatcherAlert({
 *   action: "add",
 *   alert_id: "cpu-high",
 *   monitor_id: "cpu",
 *   metric: "utilization",
 *   operator: ">",
 *   threshold: 90,
 *   message: "CPU usage above 90%"
 * })
 * ```
 */

export { WatcherListTool, WatcherStatusTool } from "./watcher-status.ts";
export { WatcherAlertTool } from "./watcher-alert.ts";
