/**
 * Tests for monitor implementations - GPU, CPU, Memory, Disk, Network
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { GPUMonitor } from "../../../src/services/watcher/monitors/gpu.ts";
import { CPUMonitor } from "../../../src/services/watcher/monitors/cpu.ts";
import { MemoryMonitor } from "../../../src/services/watcher/monitors/memory.ts";
import { DiskMonitor } from "../../../src/services/watcher/monitors/disk.ts";
import { NetworkMonitor } from "../../../src/services/watcher/monitors/network.ts";

// =============================================================================
// GPU Monitor Tests
// =============================================================================

Deno.test("GPUMonitor - has correct type and name", () => {
  const monitor = new GPUMonitor();
  assertEquals(monitor.type, "gpu");
  assertEquals(monitor.name, "NVIDIA GPU Monitor");
  assertExists(monitor.description);
});

Deno.test("GPUMonitor - getCommand returns nvidia-smi command", () => {
  const monitor = new GPUMonitor();
  const cmd = monitor.getCommand();
  assertEquals(cmd.includes("nvidia-smi"), true);
  assertEquals(cmd.includes("--query-gpu"), true);
});

Deno.test("GPUMonitor - parseOutput handles valid output", () => {
  const monitor = new GPUMonitor();
  const stdout = `0, NVIDIA GeForce RTX 3080, 45, 2048, 10240, 65
1, NVIDIA GeForce RTX 3080, 30, 1024, 10240, 60`;

  const reading = monitor.parseOutput(stdout);

  assertEquals(reading.type, "gpu");
  assertEquals(reading.values.gpuCount, 2);
  assertEquals(reading.values.avgUtilization, 38); // (45+30)/2 rounded
  assertEquals(reading.values.totalMemoryUsed, 3072); // 2048+1024
  assertEquals(reading.values.totalMemoryTotal, 20480);
  assertEquals(reading.values.maxTemperature, 65);
  assertExists(reading.timestamp);
});

Deno.test("GPUMonitor - parseOutput handles empty output", () => {
  const monitor = new GPUMonitor();
  const reading = monitor.parseOutput("");

  assertEquals(reading.values.gpuCount, 0);
  assertEquals(reading.values.avgUtilization, 0);
});

Deno.test("GPUMonitor - parseOutput handles single GPU", () => {
  const monitor = new GPUMonitor();
  const stdout = "0, NVIDIA GeForce RTX 4090, 80, 5000, 24000, 72";

  const reading = monitor.parseOutput(stdout);

  assertEquals(reading.values.gpuCount, 1);
  assertEquals(reading.values.avgUtilization, 80);
  assertEquals(reading.values.memoryUsagePercent, 21); // 5000/24000 = 20.8%
});

// =============================================================================
// CPU Monitor Tests
// =============================================================================

Deno.test("CPUMonitor - has correct type and name", () => {
  const monitor = new CPUMonitor();
  assertEquals(monitor.type, "cpu");
  assertEquals(monitor.name, "CPU Monitor");
});

Deno.test("CPUMonitor - getCommand reads proc files", () => {
  const monitor = new CPUMonitor();
  const cmd = monitor.getCommand();
  assertEquals(cmd.includes("/proc/stat"), true);
  assertEquals(cmd.includes("/proc/loadavg"), true);
  assertEquals(cmd.includes("nproc"), true);
});

Deno.test("CPUMonitor - parseOutput handles valid output", () => {
  const monitor = new CPUMonitor();
  // cpu user nice system idle iowait irq softirq steal
  const stdout = `cpu  10000 500 3000 80000 1000 100 50 0
1.50 1.20 0.90 2/150 12345
8`;

  const reading = monitor.parseOutput(stdout);

  assertEquals(reading.type, "cpu");
  assertEquals(reading.values.load1, "1.50");
  assertEquals(reading.values.load5, "1.20");
  assertEquals(reading.values.load15, "0.90");
  assertEquals(reading.values.cores, 8);
  assertEquals(reading.values.runningProcesses, 2);
  assertEquals(reading.values.totalProcesses, 150);
  assertExists(reading.values.utilization);
});

// =============================================================================
// Memory Monitor Tests
// =============================================================================

Deno.test("MemoryMonitor - has correct type and name", () => {
  const monitor = new MemoryMonitor();
  assertEquals(monitor.type, "memory");
  assertEquals(monitor.name, "Memory Monitor");
});

Deno.test("MemoryMonitor - getCommand reads meminfo", () => {
  const monitor = new MemoryMonitor();
  const cmd = monitor.getCommand();
  assertEquals(cmd.includes("/proc/meminfo"), true);
});

Deno.test("MemoryMonitor - parseOutput handles valid output", () => {
  const monitor = new MemoryMonitor();
  const stdout = `MemTotal:       16384000 kB
MemFree:         2048000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          4096000 kB
SwapTotal:       8192000 kB
SwapFree:        4096000 kB`;

  const reading = monitor.parseOutput(stdout);

  assertEquals(reading.type, "memory");
  // Total in bytes = 16384000 * 1024
  assertEquals(reading.values.totalBytes, 16384000 * 1024);
  assertEquals(reading.values.freeBytes, 2048000 * 1024);
  assertEquals(reading.values.availableBytes, 8192000 * 1024);
  assertEquals(reading.values.swapTotalBytes, 8192000 * 1024);
  assertExists(reading.values.usagePercent);
  assertExists(reading.values.totalGB);
});

// =============================================================================
// Disk Monitor Tests
// =============================================================================

Deno.test("DiskMonitor - has correct type and name", () => {
  const monitor = new DiskMonitor("/");
  assertEquals(monitor.type, "disk");
  assertEquals(monitor.name, "Disk Monitor");
  assertEquals(monitor.getPath(), "/");
});

Deno.test("DiskMonitor - constructor accepts custom path", () => {
  const monitor = new DiskMonitor("/home");
  assertEquals(monitor.getPath(), "/home");
});

Deno.test("DiskMonitor - getCommand uses df", () => {
  const monitor = new DiskMonitor("/data");
  const cmd = monitor.getCommand();
  assertEquals(cmd.includes("df -B1 /data"), true);
  assertEquals(cmd.includes("df -i /data"), true);
});

Deno.test("DiskMonitor - parseOutput handles valid output", () => {
  const monitor = new DiskMonitor("/");
  const stdout = `/dev/sda1 500000000000 200000000000 280000000000 42% /
/dev/sda1 32000000 1000000 31000000 4% /`;

  const reading = monitor.parseOutput(stdout);

  assertEquals(reading.type, "disk");
  assertEquals(reading.values.path, "/");
  assertEquals(reading.values.totalBytes, 500000000000);
  assertEquals(reading.values.usedBytes, 200000000000);
  assertEquals(reading.values.availableBytes, 280000000000);
  assertEquals(reading.values.totalInodes, 32000000);
  assertEquals(reading.values.usedInodes, 1000000);
  assertExists(reading.values.usagePercent);
  assertExists(reading.values.inodeUsagePercent);
});

// =============================================================================
// Network Monitor Tests
// =============================================================================

Deno.test("NetworkMonitor - has correct type and name", () => {
  const monitor = new NetworkMonitor("eth0");
  assertEquals(monitor.type, "network");
  assertEquals(monitor.name, "Network Monitor");
  assertEquals(monitor.getInterface(), "eth0");
});

Deno.test("NetworkMonitor - constructor accepts custom interface", () => {
  const monitor = new NetworkMonitor("ens192");
  assertEquals(monitor.getInterface(), "ens192");
});

Deno.test("NetworkMonitor - getCommand reads sys files", () => {
  const monitor = new NetworkMonitor("eth0");
  const cmd = monitor.getCommand();
  assertEquals(cmd.includes("/sys/class/net/eth0/statistics"), true);
  assertEquals(cmd.includes("rx_bytes"), true);
  assertEquals(cmd.includes("tx_bytes"), true);
});

Deno.test("NetworkMonitor - parseOutput handles valid output", () => {
  const monitor = new NetworkMonitor("eth0");
  const stdout = `1000000000
500000000
1000000
500000
10
5`;

  const reading = monitor.parseOutput(stdout);

  assertEquals(reading.type, "network");
  assertEquals(reading.values.interface, "eth0");
  assertEquals(reading.values.rxBytes, 1000000000);
  assertEquals(reading.values.txBytes, 500000000);
  assertEquals(reading.values.rxPackets, 1000000);
  assertEquals(reading.values.txPackets, 500000);
  assertEquals(reading.values.rxErrors, 10);
  assertEquals(reading.values.txErrors, 5);
  // First reading has no speed calculation
  assertEquals(reading.values.rxSpeedBps, 0);
  assertEquals(reading.values.txSpeedBps, 0);
});

Deno.test("NetworkMonitor - resetBaseline clears last reading", () => {
  const monitor = new NetworkMonitor("eth0");

  // First reading
  monitor.parseOutput("1000\n500\n10\n5\n0\n0");

  // Reset
  monitor.resetBaseline();

  // After reset, speed should be 0 again
  const reading = monitor.parseOutput("2000\n1000\n20\n10\n0\n0");
  assertEquals(reading.values.rxSpeedBps, 0);
});
