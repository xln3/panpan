/**
 * Tests for src/services/mod.ts
 * Tests service initialization and cleanup lifecycle
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  initializeServices,
  cleanupServices,
  loggerService,
  monitorRegistry,
} from "../../src/services/mod.ts";

// =============================================================================
// Setup/Teardown helpers
// =============================================================================

function resetServices(): void {
  loggerService.reset();
  monitorRegistry.clear();
}

// =============================================================================
// initializeServices tests
// =============================================================================

Deno.test("initializeServices - initializes logger with default level", () => {
  resetServices();

  initializeServices();

  // Default level is "tool"
  assertEquals(loggerService.getLevel(), "tool");

  resetServices();
});

Deno.test("initializeServices - initializes logger with custom level", () => {
  resetServices();

  initializeServices({ logLevel: "full" });

  assertEquals(loggerService.getLevel(), "full");

  resetServices();
});

Deno.test("initializeServices - registers builtin monitors", () => {
  resetServices();

  // Before init, registry should be empty
  assertEquals(monitorRegistry.size, 0);

  initializeServices();

  // After init, should have builtin monitors registered
  assertEquals(monitorRegistry.size > 0, true);

  // Should have GPU, CPU, Memory monitors at minimum
  assertEquals(monitorRegistry.get("gpu") !== undefined, true);
  assertEquals(monitorRegistry.get("cpu") !== undefined, true);
  assertEquals(monitorRegistry.get("memory") !== undefined, true);

  resetServices();
});

Deno.test("initializeServices - is idempotent for logger", () => {
  resetServices();

  initializeServices({ logLevel: "summary" });
  assertEquals(loggerService.getLevel(), "summary");

  // Second call should not change level (logger is already initialized)
  initializeServices({ logLevel: "full" });
  assertEquals(loggerService.getLevel(), "summary");

  resetServices();
});

// =============================================================================
// cleanupServices tests
// =============================================================================

Deno.test("cleanupServices - clears monitor registry", async () => {
  resetServices();
  initializeServices();

  assertEquals(monitorRegistry.size > 0, true);

  await cleanupServices();

  assertEquals(monitorRegistry.size, 0);

  resetServices();
});

Deno.test("cleanupServices - can be called multiple times safely", async () => {
  resetServices();
  initializeServices();

  await cleanupServices();
  await cleanupServices(); // Should not throw

  assertEquals(monitorRegistry.size, 0);

  resetServices();
});

// =============================================================================
// Integration tests
// =============================================================================

Deno.test("services lifecycle - init then cleanup works correctly", async () => {
  resetServices();

  // Initialize
  initializeServices({ logLevel: "llm" });
  assertEquals(loggerService.getLevel(), "llm");
  assertEquals(monitorRegistry.size > 0, true);

  // Cleanup
  await cleanupServices();
  assertEquals(monitorRegistry.size, 0);

  resetServices();
});
