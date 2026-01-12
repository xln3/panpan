import type { MonitorReading, MonitorType } from "../../../types/watcher.ts";
import { BaseMonitor } from "./base.ts";

/**
 * Network Monitor using /sys/class/net statistics.
 * Monitors network I/O for a specific interface.
 */
export class NetworkMonitor extends BaseMonitor {
  type: MonitorType = "network";
  name = "Network Monitor";
  description = "Monitor network I/O throughput";

  private interface: string;
  private lastReading?: {
    rxBytes: number;
    txBytes: number;
    timestamp: number;
  };

  /**
   * Create a network monitor for a specific interface.
   * @param iface - The network interface to monitor (default: "eth0")
   */
  constructor(iface: string = "eth0") {
    super();
    this.interface = iface;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await Deno.stat(`/sys/class/net/${this.interface}/statistics/rx_bytes`);
      return true;
    } catch {
      return false;
    }
  }

  getCommand(): string {
    return `cat /sys/class/net/${this.interface}/statistics/rx_bytes /sys/class/net/${this.interface}/statistics/tx_bytes /sys/class/net/${this.interface}/statistics/rx_packets /sys/class/net/${this.interface}/statistics/tx_packets /sys/class/net/${this.interface}/statistics/rx_errors /sys/class/net/${this.interface}/statistics/tx_errors`;
  }

  async sample(): Promise<MonitorReading> {
    const stdout = await this.executeCommand(this.getCommand());
    return this.parseOutput(stdout);
  }

  parseOutput(stdout: string): MonitorReading {
    const lines = stdout.trim().split("\n");
    const now = Date.now();

    const rxBytes = parseInt(lines[0]) || 0;
    const txBytes = parseInt(lines[1]) || 0;
    const rxPackets = parseInt(lines[2]) || 0;
    const txPackets = parseInt(lines[3]) || 0;
    const rxErrors = parseInt(lines[4]) || 0;
    const txErrors = parseInt(lines[5]) || 0;

    // Calculate speed if we have a previous reading
    let rxSpeedBps = 0;
    let txSpeedBps = 0;

    if (this.lastReading) {
      const elapsedSec = (now - this.lastReading.timestamp) / 1000;
      if (elapsedSec > 0) {
        rxSpeedBps = Math.round(
          (rxBytes - this.lastReading.rxBytes) / elapsedSec,
        );
        txSpeedBps = Math.round(
          (txBytes - this.lastReading.txBytes) / elapsedSec,
        );

        // Handle counter wraparound (negative values)
        if (rxSpeedBps < 0) rxSpeedBps = 0;
        if (txSpeedBps < 0) txSpeedBps = 0;
      }
    }

    // Save current reading for next calculation
    this.lastReading = { rxBytes, txBytes, timestamp: now };

    return this.createReading({
      interface: this.interface,
      // Total bytes transferred
      rxBytes,
      txBytes,
      // Packets
      rxPackets,
      txPackets,
      // Errors
      rxErrors,
      txErrors,
      // Speed in bytes per second
      rxSpeedBps,
      txSpeedBps,
      // Human-readable speed in Mbps
      rxSpeedMbps: ((rxSpeedBps * 8) / 1000 / 1000).toFixed(2),
      txSpeedMbps: ((txSpeedBps * 8) / 1000 / 1000).toFixed(2),
    });
  }

  /**
   * Get the monitored interface name.
   */
  getInterface(): string {
    return this.interface;
  }

  /**
   * Reset the speed calculation baseline.
   */
  resetBaseline(): void {
    this.lastReading = undefined;
  }
}
