/**
 * Tests for AlertManager - alert configuration and triggering
 */

import { assertEquals, assertExists } from "@std/assert";
import { AlertManager } from "../../../src/services/watcher/alert-manager.ts";
import type {
  Alert,
  AlertConfig,
  MonitorReading,
} from "../../../src/types/watcher.ts";

function createTestConfig(overrides: Partial<AlertConfig> = {}): AlertConfig {
  return {
    id: `alert-${Date.now()}`,
    monitorId: "cpu-local",
    metric: "utilization",
    operator: ">",
    threshold: 90,
    message: "Test alert",
    cooldown: 1000, // 1 second
    ...overrides,
  };
}

function createTestReading(
  overrides: Partial<MonitorReading> = {},
): MonitorReading {
  return {
    monitorId: "cpu-local",
    type: "cpu",
    target: "local",
    timestamp: Date.now(),
    values: { utilization: 50, load1: "1.0" },
    ...overrides,
  };
}

Deno.test("AlertManager - addConfig and getConfig", () => {
  const manager = new AlertManager();
  const config = createTestConfig({ id: "test-alert" });

  manager.addConfig(config);

  const retrieved = manager.getConfig("test-alert");
  assertEquals(retrieved, config);
});

Deno.test("AlertManager - getConfigs returns all configs", () => {
  const manager = new AlertManager();

  manager.addConfig(createTestConfig({ id: "alert1" }));
  manager.addConfig(createTestConfig({ id: "alert2" }));

  const configs = manager.getConfigs();
  assertEquals(configs.length, 2);
});

Deno.test("AlertManager - removeConfig", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({ id: "to-remove" }));

  assertEquals(manager.getConfig("to-remove") !== undefined, true);

  manager.removeConfig("to-remove");
  assertEquals(manager.getConfig("to-remove"), undefined);
});

Deno.test("AlertManager - check triggers alert when condition met (>)", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({
    id: "cpu-high",
    operator: ">",
    threshold: 90,
  }));

  // Reading with utilization > 90 should trigger
  const reading = createTestReading({ values: { utilization: 95 } });
  const alerts = manager.check(reading);

  assertEquals(alerts.length, 1);
  assertEquals(alerts[0].alertConfig.id, "cpu-high");
  assertEquals(alerts[0].acknowledged, false);
});

Deno.test("AlertManager - check does not trigger when condition not met", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({
    operator: ">",
    threshold: 90,
  }));

  // Reading with utilization < 90 should not trigger
  const reading = createTestReading({ values: { utilization: 50 } });
  const alerts = manager.check(reading);

  assertEquals(alerts.length, 0);
});

Deno.test("AlertManager - check respects cooldown period", async () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({
    id: "cooldown-test",
    operator: ">",
    threshold: 90,
    cooldown: 100, // 100ms cooldown
  }));

  const reading = createTestReading({ values: { utilization: 95 } });

  // First check should trigger
  const alerts1 = manager.check(reading);
  assertEquals(alerts1.length, 1);

  // Immediate second check should not trigger (in cooldown)
  const alerts2 = manager.check(reading);
  assertEquals(alerts2.length, 0);

  // Wait for cooldown to expire
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Third check should trigger again
  const alerts3 = manager.check(reading);
  assertEquals(alerts3.length, 1);
});

Deno.test("AlertManager - check supports all operators", () => {
  const manager = new AlertManager();

  // Test > operator
  manager.addConfig(
    createTestConfig({ id: "gt", operator: ">", threshold: 50 }),
  );
  assertEquals(
    manager.check(createTestReading({ values: { utilization: 60 } })).length,
    1,
  );
  manager.clearAll();

  // Test < operator
  manager.addConfig(
    createTestConfig({ id: "lt", operator: "<", threshold: 50 }),
  );
  assertEquals(
    manager.check(createTestReading({ values: { utilization: 40 } })).length,
    1,
  );
  manager.clearAll();

  // Test >= operator
  manager.addConfig(
    createTestConfig({ id: "gte", operator: ">=", threshold: 50 }),
  );
  assertEquals(
    manager.check(createTestReading({ values: { utilization: 50 } })).length,
    1,
  );
  manager.clearAll();

  // Test <= operator
  manager.addConfig(
    createTestConfig({ id: "lte", operator: "<=", threshold: 50 }),
  );
  assertEquals(
    manager.check(createTestReading({ values: { utilization: 50 } })).length,
    1,
  );
  manager.clearAll();

  // Test == operator
  manager.addConfig(
    createTestConfig({ id: "eq", operator: "==", threshold: 50 }),
  );
  assertEquals(
    manager.check(createTestReading({ values: { utilization: 50 } })).length,
    1,
  );
});

Deno.test("AlertManager - check only checks matching monitorId", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({
    monitorId: "cpu-local",
    operator: ">",
    threshold: 90,
  }));

  // Reading from different monitor should not trigger
  const reading = createTestReading({
    monitorId: "memory-local",
    values: { utilization: 95 },
  });
  const alerts = manager.check(reading);

  assertEquals(alerts.length, 0);
});

Deno.test("AlertManager - check parses string values", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({
    metric: "load1",
    operator: ">",
    threshold: 1.5,
  }));

  // String value "2.0" should be parsed and trigger
  const reading = createTestReading({ values: { load1: "2.0" } });
  const alerts = manager.check(reading);

  assertEquals(alerts.length, 1);
});

Deno.test("AlertManager - getUnacknowledged returns only unacknowledged", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({ id: "test", cooldown: 0 }));

  const reading = createTestReading({ values: { utilization: 95 } });

  // Trigger two alerts
  manager.check(reading);
  manager.check(reading);

  // Acknowledge first one
  manager.acknowledge(0);

  const unacked = manager.getUnacknowledged();
  assertEquals(unacked.length, 1);
});

Deno.test("AlertManager - acknowledgeAll marks all as acknowledged", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({ cooldown: 0 }));

  const reading = createTestReading({ values: { utilization: 95 } });
  manager.check(reading);
  manager.check(reading);

  manager.acknowledgeAll();

  const unacked = manager.getUnacknowledged();
  assertEquals(unacked.length, 0);
});

Deno.test("AlertManager - clearAlerts keeps configs", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({ id: "keep-config" }));
  manager.check(createTestReading({ values: { utilization: 95 } }));

  assertEquals(manager.getAll().length, 1);

  manager.clearAlerts();

  assertEquals(manager.getAll().length, 0);
  assertExists(manager.getConfig("keep-config"));
});

Deno.test("AlertManager - clearAll removes configs and alerts", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({ id: "config" }));
  manager.check(createTestReading({ values: { utilization: 95 } }));

  manager.clearAll();

  assertEquals(manager.getAll().length, 0);
  assertEquals(manager.getConfigs().length, 0);
});

Deno.test("AlertManager - getStats returns correct counts", () => {
  const manager = new AlertManager();

  // Use different monitorIds so each config triggers independently
  manager.addConfig(
    createTestConfig({ id: "config1", monitorId: "cpu-local", cooldown: 0 }),
  );
  manager.addConfig(
    createTestConfig({ id: "config2", monitorId: "memory-local", cooldown: 0 }),
  );

  // This reading matches config1 only
  const cpuReading = createTestReading({
    monitorId: "cpu-local",
    values: { utilization: 95 },
  });
  manager.check(cpuReading); // triggers 1 alert

  // This reading matches config2 only
  const memReading = createTestReading({
    monitorId: "memory-local",
    values: { utilization: 95 },
  });
  manager.check(memReading); // triggers 1 alert

  manager.acknowledge(0);

  const stats = manager.getStats();
  assertEquals(stats.totalConfigs, 2);
  assertEquals(stats.totalAlerts, 2);
  assertEquals(stats.unacknowledged, 1);
});

Deno.test("AlertManager - listener is called on alert", () => {
  const manager = new AlertManager();
  const alerts: Alert[] = [];

  manager.addListener((alert) => {
    alerts.push(alert);
  });

  manager.addConfig(createTestConfig({ operator: ">", threshold: 90 }));
  manager.check(createTestReading({ values: { utilization: 95 } }));

  assertEquals(alerts.length, 1);
});

Deno.test("AlertManager - removeListener stops notifications", () => {
  const manager = new AlertManager();
  const alerts: Alert[] = [];

  const listener = (alert: Alert) => {
    alerts.push(alert);
  };

  manager.addListener(listener);
  manager.addConfig(createTestConfig({ cooldown: 0 }));

  manager.check(createTestReading({ values: { utilization: 95 } }));
  assertEquals(alerts.length, 1);

  manager.removeListener(listener);

  manager.check(createTestReading({ values: { utilization: 95 } }));
  assertEquals(alerts.length, 1); // Still 1, no new alert
});

Deno.test("AlertManager - check ignores missing metric", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({
    metric: "nonexistent",
    operator: ">",
    threshold: 90,
  }));

  // Reading without the metric should not trigger
  const reading = createTestReading({ values: { utilization: 95 } });
  const alerts = manager.check(reading);

  assertEquals(alerts.length, 0);
});

Deno.test("AlertManager - check ignores non-numeric string values", () => {
  const manager = new AlertManager();
  manager.addConfig(createTestConfig({
    metric: "status",
    operator: ">",
    threshold: 90,
  }));

  // Non-numeric string should not trigger
  const reading = createTestReading({ values: { status: "running" } });
  const alerts = manager.check(reading);

  assertEquals(alerts.length, 0);
});
