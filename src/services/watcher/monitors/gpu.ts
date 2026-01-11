import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * GPU information for a single device
 */
interface GPUInfo {
  index: number;
  name: string;
  utilization: number;
  memoryUsed: number;
  memoryTotal: number;
  temperature: number;
}

/**
 * NVIDIA GPU Monitor using nvidia-smi.
 * Monitors GPU utilization, memory usage, and temperature.
 */
export class GPUMonitor extends BaseMonitor {
  type: MonitorType = "gpu";
  name = "NVIDIA GPU Monitor";
  description = "Monitor NVIDIA GPU utilization, memory, and temperature";

  async isAvailable(): Promise<boolean> {
    return await this.commandExists("nvidia-smi");
  }

  getCommand(): string {
    return "nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits";
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const lines = stdout.trim().split("\n").filter((line) => line.trim());
    const gpus: GPUInfo[] = [];

    for (const line of lines) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length >= 6) {
        gpus.push({
          index: parseInt(parts[0]) || 0,
          name: parts[1],
          utilization: parseInt(parts[2]) || 0,
          memoryUsed: parseInt(parts[3]) || 0,
          memoryTotal: parseInt(parts[4]) || 0,
          temperature: parseInt(parts[5]) || 0,
        });
      }
    }

    // Handle empty output
    if (gpus.length === 0) {
      return this.createReading({
        gpuCount: 0,
        avgUtilization: 0,
        totalMemoryUsed: 0,
        totalMemoryTotal: 0,
        memoryUsagePercent: 0,
        maxTemperature: 0,
        gpus: "[]",
      });
    }

    // Aggregate values across all GPUs
    const totalUtil = gpus.reduce((sum, g) => sum + g.utilization, 0);
    const avgUtil = totalUtil / gpus.length;
    const totalMemUsed = gpus.reduce((sum, g) => sum + g.memoryUsed, 0);
    const totalMemTotal = gpus.reduce((sum, g) => sum + g.memoryTotal, 0);
    const maxTemp = Math.max(...gpus.map((g) => g.temperature));
    const memPercent = totalMemTotal > 0
      ? Math.round((totalMemUsed / totalMemTotal) * 100)
      : 0;

    return this.createReading({
      gpuCount: gpus.length,
      avgUtilization: Math.round(avgUtil),
      totalMemoryUsed: totalMemUsed,
      totalMemoryTotal: totalMemTotal,
      memoryUsagePercent: memPercent,
      maxTemperature: maxTemp,
      gpus: JSON.stringify(gpus),
    });
  }
}
