import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * CPU Monitor using /proc/stat and /proc/loadavg.
 * Monitors CPU utilization and load average.
 */
export class CPUMonitor extends BaseMonitor {
  type: MonitorType = "cpu";
  name = "CPU Monitor";
  description = "Monitor CPU utilization and load average";

  async isAvailable(): Promise<boolean> {
    // CPU info is always available on Linux via /proc
    try {
      await Deno.stat("/proc/stat");
      return true;
    } catch {
      return false;
    }
  }

  getCommand(): string {
    // Use /proc/stat for CPU usage and /proc/loadavg for load average
    // Also get CPU count from nproc
    return `cat /proc/stat | head -1 && cat /proc/loadavg && nproc`;
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const lines = stdout.trim().split("\n");

    // Parse CPU stats from /proc/stat
    // cpu  user nice system idle iowait irq softirq steal guest guest_nice
    const cpuLine = lines[0] || "";
    const cpuParts = cpuLine.split(/\s+/).slice(1).map((n) => parseInt(n) || 0);

    // Calculate CPU usage percentage
    // idle = idle + iowait
    // total = user + nice + system + idle + iowait + irq + softirq + steal
    const idle = (cpuParts[3] || 0) + (cpuParts[4] || 0);
    const total = cpuParts.slice(0, 8).reduce((a, b) => a + b, 0);
    const active = total - idle;
    const utilization = total > 0 ? Math.round((active / total) * 100) : 0;

    // Parse load average from /proc/loadavg
    // load1 load5 load15 running/total lastpid
    const loadLine = lines[1] || "";
    const loadParts = loadLine.split(/\s+/);
    const load1 = parseFloat(loadParts[0]) || 0;
    const load5 = parseFloat(loadParts[1]) || 0;
    const load15 = parseFloat(loadParts[2]) || 0;

    // Parse running/total processes
    const runningTotal = loadParts[3] || "0/0";
    const [running, totalProcs] = runningTotal.split("/").map((n) =>
      parseInt(n) || 0
    );

    // Get CPU core count
    const cores = parseInt(lines[2]) || 1;

    return this.createReading({
      utilization,
      load1: load1.toFixed(2),
      load5: load5.toFixed(2),
      load15: load15.toFixed(2),
      cores,
      loadPerCore: (load1 / cores).toFixed(2),
      runningProcesses: running,
      totalProcesses: totalProcs,
    });
  }
}
