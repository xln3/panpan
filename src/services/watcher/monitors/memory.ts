import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * Memory Monitor using /proc/meminfo.
 * Monitors RAM usage including available, used, cached, and swap.
 */
export class MemoryMonitor extends BaseMonitor {
  type: MonitorType = "memory";
  name = "Memory Monitor";
  description = "Monitor RAM and swap usage";

  async isAvailable(): Promise<boolean> {
    try {
      await Deno.stat("/proc/meminfo");
      return true;
    } catch {
      return false;
    }
  }

  getCommand(): string {
    // Get memory info from /proc/meminfo
    return "cat /proc/meminfo";
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const memInfo: Record<string, number> = {};

    // Parse /proc/meminfo format: "Key:        12345 kB"
    for (const line of stdout.split("\n")) {
      const match = line.match(/^(\w+):\s+(\d+)\s*(?:kB)?$/);
      if (match) {
        // Convert kB to bytes
        memInfo[match[1]] = parseInt(match[2]) * 1024;
      }
    }

    const totalBytes = memInfo["MemTotal"] || 0;
    const freeBytes = memInfo["MemFree"] || 0;
    const availableBytes = memInfo["MemAvailable"] || freeBytes;
    const buffersBytes = memInfo["Buffers"] || 0;
    const cachedBytes = memInfo["Cached"] || 0;

    // Used = Total - Free - Buffers - Cached
    const usedBytes = totalBytes - freeBytes - buffersBytes - cachedBytes;

    // Swap info
    const swapTotalBytes = memInfo["SwapTotal"] || 0;
    const swapFreeBytes = memInfo["SwapFree"] || 0;
    const swapUsedBytes = swapTotalBytes - swapFreeBytes;

    const usagePercent = totalBytes > 0
      ? Math.round((usedBytes / totalBytes) * 100)
      : 0;
    const swapUsagePercent = swapTotalBytes > 0
      ? Math.round((swapUsedBytes / swapTotalBytes) * 100)
      : 0;

    return this.createReading({
      totalBytes,
      usedBytes,
      freeBytes,
      availableBytes,
      buffersBytes,
      cachedBytes,
      usagePercent,
      // Human-readable values in GB
      totalGB: (totalBytes / 1024 / 1024 / 1024).toFixed(2),
      usedGB: (usedBytes / 1024 / 1024 / 1024).toFixed(2),
      availableGB: (availableBytes / 1024 / 1024 / 1024).toFixed(2),
      // Swap info
      swapTotalBytes,
      swapUsedBytes,
      swapFreeBytes,
      swapUsagePercent,
    });
  }
}
