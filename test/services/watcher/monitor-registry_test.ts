/**
 * Tests for MonitorRegistry - monitor registration and lookup
 */

import { assertEquals, assertExists } from "@std/assert";
import { MonitorRegistry } from "../../../src/services/watcher/monitor-registry.ts";
import { CPUMonitor } from "../../../src/services/watcher/monitors/cpu.ts";
import { MemoryMonitor } from "../../../src/services/watcher/monitors/memory.ts";
import { DiskMonitor } from "../../../src/services/watcher/monitors/disk.ts";
import type {
  Monitor,
  MonitorReading,
  MonitorType,
} from "../../../src/types/watcher.ts";

// Mock monitor for testing
class MockMonitor implements Monitor {
  type: MonitorType = "custom";
  name = "Mock Monitor";
  description = "A mock monitor for testing";
  private available: boolean;

  constructor(available: boolean = true) {
    this.available = available;
  }

  async isAvailable(): Promise<boolean> {
    return await Promise.resolve(this.available);
  }

  async sample(): Promise<MonitorReading> {
    return await Promise.resolve({
      monitorId: "mock-local",
      type: this.type,
      target: "local",
      timestamp: Date.now(),
      values: { testValue: 42 },
    });
  }

  getCommand(): string {
    return "echo 42";
  }

  parseOutput(stdout: string): MonitorReading {
    return {
      monitorId: "mock-local",
      type: this.type,
      target: "local",
      timestamp: Date.now(),
      values: { testValue: parseInt(stdout.trim()) || 0 },
    };
  }
}

Deno.test("MonitorRegistry - register and get monitor", () => {
  const registry = new MonitorRegistry();
  const monitor = new MockMonitor();

  registry.register("test-monitor", monitor);

  const retrieved = registry.get("test-monitor");
  assertEquals(retrieved, monitor);
});

Deno.test("MonitorRegistry - get returns undefined for unknown ID", () => {
  const registry = new MonitorRegistry();

  const result = registry.get("nonexistent");
  assertEquals(result, undefined);
});

Deno.test("MonitorRegistry - unregister removes monitor", () => {
  const registry = new MonitorRegistry();
  const monitor = new MockMonitor();

  registry.register("test", monitor);
  assertEquals(registry.get("test"), monitor);

  registry.unregister("test");
  assertEquals(registry.get("test"), undefined);
});

Deno.test("MonitorRegistry - list returns all monitors", () => {
  const registry = new MonitorRegistry();

  registry.register("mon1", new MockMonitor());
  registry.register("mon2", new MockMonitor());

  const list = registry.list();
  assertEquals(list.length, 2);
  assertEquals(list.some((m) => m.id === "mon1"), true);
  assertEquals(list.some((m) => m.id === "mon2"), true);
});

Deno.test("MonitorRegistry - getByType filters correctly", () => {
  const registry = new MonitorRegistry();

  registry.register("cpu", new CPUMonitor());
  registry.register("memory", new MemoryMonitor());
  registry.register("disk", new DiskMonitor("/"));

  const cpuMonitors = registry.getByType("cpu");
  assertEquals(cpuMonitors.length, 1);
  assertEquals(cpuMonitors[0].type, "cpu");

  const memoryMonitors = registry.getByType("memory");
  assertEquals(memoryMonitors.length, 1);
});

Deno.test("MonitorRegistry - getAvailable filters unavailable monitors", async () => {
  const registry = new MonitorRegistry();

  registry.register("available", new MockMonitor(true));
  registry.register("unavailable", new MockMonitor(false));

  const available = await registry.getAvailable();
  assertEquals(available.length, 1);
  assertEquals(available[0].name, "Mock Monitor");
});

Deno.test("MonitorRegistry - getSummary includes availability", async () => {
  const registry = new MonitorRegistry();

  registry.register("avail", new MockMonitor(true));
  registry.register("unavail", new MockMonitor(false));

  const summary = await registry.getSummary();
  assertEquals(summary.length, 2);

  const availEntry = summary.find((s) => s.id === "avail");
  const unavailEntry = summary.find((s) => s.id === "unavail");

  assertExists(availEntry);
  assertExists(unavailEntry);
  assertEquals(availEntry.available, true);
  assertEquals(unavailEntry.available, false);
});

Deno.test("MonitorRegistry - clear removes all monitors", () => {
  const registry = new MonitorRegistry();

  registry.register("mon1", new MockMonitor());
  registry.register("mon2", new MockMonitor());
  assertEquals(registry.size, 2);

  registry.clear();
  assertEquals(registry.size, 0);
});

Deno.test("MonitorRegistry - size property", () => {
  const registry = new MonitorRegistry();
  assertEquals(registry.size, 0);

  registry.register("mon1", new MockMonitor());
  assertEquals(registry.size, 1);

  registry.register("mon2", new MockMonitor());
  assertEquals(registry.size, 2);
});

Deno.test("MonitorRegistry - registerBuiltinMonitors adds default monitors", () => {
  const registry = new MonitorRegistry();
  assertEquals(registry.size, 0);

  registry.registerBuiltinMonitors();

  // Should have at least gpu, cpu, memory, disk-root
  assertEquals(registry.size >= 4, true);
  assertExists(registry.get("gpu"));
  assertExists(registry.get("cpu"));
  assertExists(registry.get("memory"));
  assertExists(registry.get("disk-root"));
});

Deno.test("MonitorRegistry - sampleAll returns readings for available monitors", async () => {
  const registry = new MonitorRegistry();

  registry.register("avail1", new MockMonitor(true));
  registry.register("avail2", new MockMonitor(true));
  registry.register("unavail", new MockMonitor(false));

  const readings = await registry.sampleAll();

  // Only 2 available monitors should have readings
  assertEquals(readings.size, 2);
  assertEquals(readings.has("avail1"), true);
  assertEquals(readings.has("avail2"), true);
  assertEquals(readings.has("unavail"), false);
});

Deno.test("MonitorRegistry - register overwrites existing", () => {
  const registry = new MonitorRegistry();

  const monitor1 = new MockMonitor();
  const monitor2 = new MockMonitor();

  registry.register("test", monitor1);
  assertEquals(registry.get("test"), monitor1);

  registry.register("test", monitor2);
  assertEquals(registry.get("test"), monitor2);
  assertEquals(registry.size, 1);
});
