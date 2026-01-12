/**
 * Tests for Watcher Tools
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  WatcherListTool,
  WatcherStatusTool,
} from "../../src/tools/watcher/watcher-status.ts";
import { WatcherAlertTool } from "../../src/tools/watcher/watcher-alert.ts";
import {
  alertManager,
  monitorRegistry,
} from "../../src/services/watcher/mod.ts";
import { collectGenerator, createMockToolContext } from "../_helpers/mod.ts";
import type { ToolYield } from "../../src/types/tool.ts";

// Type helper
function getResultData<T>(results: ToolYield<T>[]): T {
  const result = results.find((r) => r.type === "result");
  if (!result || result.type !== "result") {
    throw new Error("Expected result type");
  }
  return result.data;
}

// Reset watcher state before tests
function resetWatcherState() {
  monitorRegistry.clear();
  alertManager.clearAll();
}

// ============================================================================
// WatcherStatusTool Tests
// ============================================================================

Deno.test("WatcherStatusTool - has correct metadata", () => {
  assertEquals(WatcherStatusTool.name, "WatcherStatus");
  assertEquals(WatcherStatusTool.isReadOnly(), true);
  assertEquals(WatcherStatusTool.isConcurrencySafe(), true);
});

Deno.test("WatcherStatusTool - registers monitors on first call", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  await collectGenerator(
    WatcherStatusTool.call({ monitors: ["cpu"], check_alerts: true }, context),
  );

  // Monitors should be registered now
  assertEquals(monitorRegistry.size > 0, true);
});

Deno.test("WatcherStatusTool - returns readings for available monitors", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherStatusTool.call({ monitors: ["all"], check_alerts: true }, context),
  );

  const data = getResultData(results);
  assertExists(data.readings);
  assertExists(data.summary);
  // readings may be empty if no monitors available on test system
  assertEquals(Array.isArray(data.readings), true);
});

Deno.test("WatcherStatusTool - filters by monitor type", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherStatusTool.call({ monitors: ["cpu"], check_alerts: true }, context),
  );

  const data = getResultData(results);
  // If there are readings, they should all be CPU type
  for (const r of data.readings) {
    assertEquals(r.type, "cpu");
  }
});

Deno.test("WatcherStatusTool - checks alerts when enabled", async () => {
  resetWatcherState();
  monitorRegistry.registerBuiltinMonitors();

  // Add a low threshold alert that should trigger
  alertManager.addConfig({
    id: "test-alert",
    monitorId: "cpu",
    metric: "utilization",
    operator: ">=",
    threshold: 0, // Always triggers
    message: "Test alert",
    cooldown: 0,
  });

  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherStatusTool.call({ monitors: ["cpu"], check_alerts: true }, context),
  );

  const data = getResultData(results);
  assertExists(data.alerts);
  assertEquals(Array.isArray(data.alerts), true);
});

Deno.test("WatcherStatusTool - skips alert check when disabled", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherStatusTool.call({ monitors: ["cpu"], check_alerts: false }, context),
  );

  const data = getResultData(results);
  assertEquals(data.alerts.length, 0);
});

// ============================================================================
// WatcherListTool Tests
// ============================================================================

Deno.test("WatcherListTool - has correct metadata", () => {
  assertEquals(WatcherListTool.name, "WatcherList");
  assertEquals(WatcherListTool.isReadOnly(), true);
  assertEquals(WatcherListTool.isConcurrencySafe(), true);
});

Deno.test("WatcherListTool - returns monitor list", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherListTool.call({}, context),
  );

  const data = getResultData(results);
  assertExists(data.monitors);
  assertEquals(Array.isArray(data.monitors), true);
  // Should have at least some built-in monitors
  assertEquals(data.monitors.length > 0, true);
});

Deno.test("WatcherListTool - includes availability info", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherListTool.call({}, context),
  );

  const data = getResultData(results);
  for (const m of data.monitors) {
    assertExists(m.id);
    assertExists(m.type);
    assertExists(m.name);
    assertEquals(typeof m.available, "boolean");
  }
});

// ============================================================================
// WatcherAlertTool Tests
// ============================================================================

Deno.test("WatcherAlertTool - has correct metadata", () => {
  assertEquals(WatcherAlertTool.name, "WatcherAlert");
  assertEquals(WatcherAlertTool.isReadOnly(), false);
  assertEquals(WatcherAlertTool.isConcurrencySafe(), false);
});

Deno.test("WatcherAlertTool - add action creates alert config", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherAlertTool.call({
      action: "add",
      alert_id: "cpu-high",
      monitor_id: "cpu",
      metric: "utilization",
      operator: ">",
      threshold: 90,
      message: "CPU usage above 90%",
      cooldown: 60000,
    }, context),
  );

  const data = getResultData(results);
  assertEquals(data.success, true);
  assertEquals(data.action, "add");
  assertEquals(alertManager.getConfig("cpu-high") !== undefined, true);
});

Deno.test("WatcherAlertTool - add action validates required fields", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherAlertTool.call({
      action: "add",
      alert_id: "incomplete",
      cooldown: 60000,
      // Missing other required fields
    }, context),
  );

  const data = getResultData(results);
  assertEquals(data.success, false);
  assertExists(data.error);
  assertStringIncludes(data.error!, "Missing required fields");
});

Deno.test("WatcherAlertTool - remove action deletes alert config", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  // First add an alert
  alertManager.addConfig({
    id: "to-remove",
    monitorId: "cpu",
    metric: "utilization",
    operator: ">",
    threshold: 50,
    message: "Test",
    cooldown: 0,
  });

  const results = await collectGenerator(
    WatcherAlertTool.call({
      action: "remove",
      alert_id: "to-remove",
      cooldown: 60000,
    }, context),
  );

  const data = getResultData(results);
  assertEquals(data.success, true);
  assertEquals(alertManager.getConfig("to-remove"), undefined);
});

Deno.test("WatcherAlertTool - remove action handles nonexistent alert", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherAlertTool.call({
      action: "remove",
      alert_id: "nonexistent",
      cooldown: 60000,
    }, context),
  );

  const data = getResultData(results);
  assertEquals(data.success, false); // No alert to remove
});

Deno.test("WatcherAlertTool - list action returns all configs", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  // Add some alerts
  alertManager.addConfig({
    id: "alert-1",
    monitorId: "cpu",
    metric: "utilization",
    operator: ">",
    threshold: 90,
    message: "High CPU",
    cooldown: 0,
  });
  alertManager.addConfig({
    id: "alert-2",
    monitorId: "memory",
    metric: "used_percent",
    operator: ">",
    threshold: 80,
    message: "High memory",
    cooldown: 0,
  });

  const results = await collectGenerator(
    WatcherAlertTool.call({ action: "list", cooldown: 60000 }, context),
  );

  const data = getResultData(results);
  assertEquals(data.success, true);
  assertEquals(data.configs?.length, 2);
  assertEquals(data.stats?.totalConfigs, 2);
});

Deno.test("WatcherAlertTool - clear action removes all configs", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  // Add an alert
  alertManager.addConfig({
    id: "to-clear",
    monitorId: "cpu",
    metric: "utilization",
    operator: ">",
    threshold: 50,
    message: "Test",
    cooldown: 0,
  });

  const results = await collectGenerator(
    WatcherAlertTool.call({ action: "clear", cooldown: 60000 }, context),
  );

  const data = getResultData(results);
  assertEquals(data.success, true);
  assertEquals(alertManager.getConfigs().length, 0);
});

Deno.test("WatcherAlertTool - acknowledge action acks all alerts", async () => {
  resetWatcherState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    WatcherAlertTool.call({ action: "acknowledge", cooldown: 60000 }, context),
  );

  const data = getResultData(results);
  assertEquals(data.success, true);
  assertEquals(alertManager.getUnacknowledged().length, 0);
});

// ============================================================================
// renderResultForAssistant Tests
// ============================================================================

Deno.test("WatcherStatusTool - renderResultForAssistant returns summary", () => {
  const output = {
    readings: [{
      monitorId: "cpu",
      type: "cpu" as const,
      values: { utilization: 45.5 },
      timestamp: Date.now(),
    }],
    alerts: [],
    summary: "CPU: 45.5%",
  };
  const result = WatcherStatusTool.renderResultForAssistant(output);
  assertEquals(result, output.summary);
});

Deno.test("WatcherListTool - renderResultForAssistant shows count", () => {
  const output = {
    monitors: [
      {
        id: "cpu",
        type: "cpu" as const,
        name: "CPU",
        description: "",
        available: true,
      },
      {
        id: "gpu",
        type: "gpu" as const,
        name: "GPU",
        description: "",
        available: false,
      },
    ],
  };
  const result = WatcherListTool.renderResultForAssistant(output);
  assertStringIncludes(result, "1/2");
});

Deno.test("WatcherAlertTool - renderResultForAssistant shows stats", () => {
  const output = {
    action: "list",
    success: true,
    configs: [],
    stats: { totalConfigs: 3, totalAlerts: 5, unacknowledged: 2 },
  };
  const result = WatcherAlertTool.renderResultForAssistant(output);
  assertStringIncludes(result, "3");
  assertStringIncludes(result, "2");
});
