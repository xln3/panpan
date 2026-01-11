import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * Disk Monitor using df command.
 * Monitors disk space and inode usage for a specified path.
 */
export class DiskMonitor extends BaseMonitor {
  type: MonitorType = "disk";
  name = "Disk Monitor";
  description = "Monitor disk space and inode usage";

  private path: string;

  /**
   * Create a disk monitor for a specific path.
   * @param path - The filesystem path to monitor (default: "/")
   */
  constructor(path: string = "/") {
    super();
    this.path = path;
  }

  async isAvailable(): Promise<boolean> {
    // df is universally available on Linux
    return await this.commandExists("df");
  }

  getCommand(): string {
    // Get both disk space (in bytes) and inode usage
    return `df -B1 ${this.path} | tail -1 && df -i ${this.path} | tail -1`;
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const lines = stdout.trim().split("\n");

    // Parse disk space: Filesystem 1B-blocks Used Available Use% Mounted
    const spaceParts = (lines[0] || "").split(/\s+/);
    const filesystem = spaceParts[0] || "";
    const totalBytes = parseInt(spaceParts[1]) || 0;
    const usedBytes = parseInt(spaceParts[2]) || 0;
    const availableBytes = parseInt(spaceParts[3]) || 0;

    // Parse inodes: Filesystem Inodes IUsed IFree IUse% Mounted
    const inodeParts = (lines[1] || "").split(/\s+/);
    const totalInodes = parseInt(inodeParts[1]) || 0;
    const usedInodes = parseInt(inodeParts[2]) || 0;
    const availableInodes = parseInt(inodeParts[3]) || 0;

    const usagePercent = totalBytes > 0
      ? Math.round((usedBytes / totalBytes) * 100)
      : 0;
    const inodeUsagePercent = totalInodes > 0
      ? Math.round((usedInodes / totalInodes) * 100)
      : 0;

    return this.createReading({
      path: this.path,
      filesystem,
      // Space in bytes
      totalBytes,
      usedBytes,
      availableBytes,
      usagePercent,
      // Human-readable in GB
      totalGB: (totalBytes / 1024 / 1024 / 1024).toFixed(2),
      usedGB: (usedBytes / 1024 / 1024 / 1024).toFixed(2),
      availableGB: (availableBytes / 1024 / 1024 / 1024).toFixed(2),
      // Inode info
      totalInodes,
      usedInodes,
      availableInodes,
      inodeUsagePercent,
    });
  }

  /**
   * Get the monitored path.
   */
  getPath(): string {
    return this.path;
  }
}
