import type { Monitor, MonitorType } from "../../types/watcher.ts";
import { GPUMonitor } from "./monitors/gpu.ts";
import { CPUMonitor } from "./monitors/cpu.ts";
import { MemoryMonitor } from "./monitors/memory.ts";
import { DiskMonitor } from "./monitors/disk.ts";
import { NetworkMonitor } from "./monitors/network.ts";

/**
 * Registry for managing monitor instances.
 * Provides registration, lookup, and availability checking.
 */
class MonitorRegistry {
  private monitors = new Map<string, Monitor>();

  /**
   * Register all built-in monitors with common configurations.
   */
  registerBuiltinMonitors(): void {
    // GPU monitor
    this.register("gpu", new GPUMonitor());

    // CPU monitor
    this.register("cpu", new CPUMonitor());

    // Memory monitor
    this.register("memory", new MemoryMonitor());

    // Disk monitors for common paths
    this.register("disk-root", new DiskMonitor("/"));

    const home = Deno.env.get("HOME");
    if (home) {
      this.register("disk-home", new DiskMonitor(home));
    }

    // Network monitors for common interfaces
    // We register multiple candidates; users can check availability
    this.register("network-eth0", new NetworkMonitor("eth0"));
    this.register("network-ens0", new NetworkMonitor("ens0"));
    this.register("network-enp0s3", new NetworkMonitor("enp0s3"));
  }

  /**
   * Register a monitor with a unique ID.
   * @param id - Unique identifier for the monitor
   * @param monitor - Monitor instance
   */
  register(id: string, monitor: Monitor): void {
    this.monitors.set(id, monitor);
  }

  /**
   * Unregister a monitor by ID.
   * @param id - Monitor ID to remove
   */
  unregister(id: string): void {
    this.monitors.delete(id);
  }

  /**
   * Get a monitor by ID.
   * @param id - Monitor ID
   */
  get(id: string): Monitor | undefined {
    return this.monitors.get(id);
  }

  /**
   * Get all monitors that are available on the current system.
   * @returns Array of available monitors
   */
  async getAvailable(): Promise<Monitor[]> {
    const available: Monitor[] = [];

    for (const monitor of this.monitors.values()) {
      try {
        if (await monitor.isAvailable()) {
          available.push(monitor);
        }
      } catch {
        // Monitor check failed, skip it
      }
    }

    return available;
  }

  /**
   * Get all monitors of a specific type.
   * @param type - Monitor type to filter by
   */
  getByType(type: MonitorType): Monitor[] {
    return Array.from(this.monitors.values()).filter((m) => m.type === type);
  }

  /**
   * List all registered monitors with their IDs.
   */
  list(): { id: string; monitor: Monitor }[] {
    return Array.from(this.monitors.entries()).map(([id, monitor]) => ({
      id,
      monitor,
    }));
  }

  /**
   * Get a summary of all monitors and their availability.
   */
  async getSummary(): Promise<{
    id: string;
    type: MonitorType;
    name: string;
    available: boolean;
  }[]> {
    const results = [];

    for (const [id, monitor] of this.monitors.entries()) {
      let available = false;
      try {
        available = await monitor.isAvailable();
      } catch {
        // Check failed
      }

      results.push({
        id,
        type: monitor.type,
        name: monitor.name,
        available,
      });
    }

    return results;
  }

  /**
   * Sample all available monitors at once.
   * @returns Map of monitor ID to reading
   */
  async sampleAll(): Promise<Map<string, Awaited<ReturnType<Monitor["sample"]>>>> {
    const results = new Map();
    const available = await this.getAvailable();

    for (const monitor of available) {
      // Find the ID for this monitor
      for (const [id, m] of this.monitors.entries()) {
        if (m === monitor) {
          try {
            const reading = await monitor.sample();
            results.set(id, reading);
          } catch {
            // Sample failed, skip
          }
          break;
        }
      }
    }

    return results;
  }

  /**
   * Clear all registered monitors.
   */
  clear(): void {
    this.monitors.clear();
  }

  /**
   * Get the number of registered monitors.
   */
  get size(): number {
    return this.monitors.size;
  }
}

// Export singleton instance
export const monitorRegistry = new MonitorRegistry();

// Also export the class for testing
export { MonitorRegistry };
