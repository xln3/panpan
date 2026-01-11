/**
 * Tests for Logger hooks
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { createLoggerHooks } from "../../../src/services/logger/hooks.ts";
import { LogStorage } from "../../../src/services/logger/log-storage.ts";
import type { LogLevel } from "../../../src/types/logger.ts";

Deno.test("createLoggerHooks - hooks record at correct levels", () => {
  const storage = new LogStorage();
  let currentLevel: LogLevel = "tool";
  const hooks = createLoggerHooks(storage, () => currentLevel);

  // Tool start should be recorded at tool level
  hooks.onToolStart("TestTool", { input: "test" });
  assertEquals(storage.size(), 1);

  // Change to summary level
  currentLevel = "summary";
  storage.clear();

  // Tool start should NOT be recorded at summary level
  hooks.onToolStart("TestTool2", { input: "test2" });
  assertEquals(storage.size(), 0);
});

Deno.test("createLoggerHooks - onToolError always records", () => {
  const storage = new LogStorage();
  const hooks = createLoggerHooks(storage, () => "summary");

  hooks.onToolError("TestTool", new Error("Test error"));

  // Errors should be recorded even at summary level
  const entries = storage.getAll();
  assertEquals(entries.length >= 1, true);
  assertEquals(entries.some(e => e.success === false), true);
});

Deno.test("createLoggerHooks - onAbort always records", () => {
  const storage = new LogStorage();
  const hooks = createLoggerHooks(storage, () => "summary");

  hooks.onAbort("User cancelled");

  const entries = storage.getAll();
  assertEquals(entries.length, 1);
  assertEquals(entries[0].type, "abort");
  assertEquals(entries[0].success, false);
});

Deno.test("createLoggerHooks - onToolComplete records at multiple levels", () => {
  const storage = new LogStorage();
  const hooks = createLoggerHooks(storage, () => "tool");

  hooks.onToolComplete("TestTool", { result: "success" }, 100);

  // Should record at both tool and summary levels
  const entries = storage.getAll();
  assertEquals(entries.length, 2);
  assertEquals(entries.some(e => e.level === "tool"), true);
  assertEquals(entries.some(e => e.level === "summary"), true);
});

Deno.test("createLoggerHooks - onLLMResponse records duration", () => {
  const storage = new LogStorage();
  const hooks = createLoggerHooks(storage, () => "llm");

  hooks.onLLMResponse({ content: "test" }, 500);

  const entries = storage.getAll();
  const llmEntry = entries.find(e => e.type === "llm_response" && e.level === "llm");

  assertExists(llmEntry);
  assertEquals(llmEntry.duration, 500);
});

Deno.test("createLoggerHooks - onSAInvoke records subagent calls", () => {
  const storage = new LogStorage();
  const hooks = createLoggerHooks(storage, () => "tool");

  hooks.onSAInvoke("Explore", "Find all TypeScript files");

  const entries = storage.getAll();
  const saEntry = entries.find(e => e.type === "sa_invoke");

  assertExists(saEntry);
  assertEquals((saEntry.data as Record<string, unknown>).agentType, "Explore");
});

Deno.test("createLoggerHooks - full level records everything", () => {
  const storage = new LogStorage();
  const hooks = createLoggerHooks(storage, () => "full");

  hooks.onQueryStart([{ role: "user", content: "test" }]);
  hooks.onToolStart("TestTool", { input: "test" });
  hooks.onToolProgress("TestTool", "50% complete");
  hooks.onToolComplete("TestTool", { result: "done" }, 100);

  // At full level, all events should be recorded
  const entries = storage.getAll();
  assertEquals(entries.length >= 4, true);
});
