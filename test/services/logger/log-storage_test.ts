/**
 * Tests for LogStorage - multi-level log storage
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { LogStorage } from "../../../src/services/logger/log-storage.ts";
import type { LogEntry } from "../../../src/types/logger.ts";

function createTestEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: crypto.randomUUID(),
    level: "tool",
    timestamp: Date.now(),
    type: "tool_call",
    data: { toolName: "TestTool" },
    success: true,
    ...overrides,
  };
}

Deno.test("LogStorage - add and retrieve entries", () => {
  const storage = new LogStorage();

  const entry = createTestEntry();
  storage.add(entry);

  assertEquals(storage.size(), 1);
  assertEquals(storage.getAll()[0].id, entry.id);
});

Deno.test("LogStorage - query by level", () => {
  const storage = new LogStorage();

  storage.add(createTestEntry({ level: "summary" }));
  storage.add(createTestEntry({ level: "tool" }));
  storage.add(createTestEntry({ level: "llm" }));
  storage.add(createTestEntry({ level: "full" }));

  // Query at summary level - should only get summary entries
  const summaryOnly = storage.query({ level: "summary" });
  assertEquals(summaryOnly.length, 1);

  // Query at tool level - should get summary and tool entries
  const toolLevel = storage.query({ level: "tool" });
  assertEquals(toolLevel.length, 2);

  // Query at full level - should get all entries
  const fullLevel = storage.query({ level: "full" });
  assertEquals(fullLevel.length, 4);
});

Deno.test("LogStorage - query by type", () => {
  const storage = new LogStorage();

  storage.add(createTestEntry({ type: "tool_call" }));
  storage.add(createTestEntry({ type: "tool_result" }));
  storage.add(createTestEntry({ type: "llm_request" }));

  const toolCalls = storage.query({ type: "tool_call" });
  assertEquals(toolCalls.length, 1);
  assertEquals(toolCalls[0].type, "tool_call");
});

Deno.test("LogStorage - query failures only", () => {
  const storage = new LogStorage();

  storage.add(createTestEntry({ success: true }));
  storage.add(createTestEntry({ success: true }));
  storage.add(createTestEntry({ success: false, error: "Test error" }));

  const failures = storage.query({ failuresOnly: true });
  assertEquals(failures.length, 1);
  assertEquals(failures[0].success, false);
});

Deno.test("LogStorage - query with limit", () => {
  const storage = new LogStorage();

  for (let i = 0; i < 10; i++) {
    storage.add(createTestEntry());
  }

  const limited = storage.query({ limit: 3 });
  assertEquals(limited.length, 3);
});

Deno.test("LogStorage - respects maxEntries config", () => {
  const storage = new LogStorage({ maxEntries: 5 });

  for (let i = 0; i < 10; i++) {
    storage.add(createTestEntry({ data: { index: i } }));
  }

  assertEquals(storage.size(), 5);

  // Should keep the most recent entries
  const all = storage.getAll();
  assertEquals((all[0].data as Record<string, number>).index, 5);
});

Deno.test("LogStorage - clear removes all entries", () => {
  const storage = new LogStorage();

  storage.add(createTestEntry());
  storage.add(createTestEntry());
  assertEquals(storage.size(), 2);

  storage.clear();
  assertEquals(storage.size(), 0);
});

Deno.test("LogStorage - export JSON format", () => {
  const storage = new LogStorage();
  storage.add(createTestEntry({ data: { test: "value" } }));

  const json = storage.exportJSON();
  const parsed = JSON.parse(json);

  assertExists(parsed);
  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed.length, 1);
});

Deno.test("LogStorage - export Markdown format", () => {
  const storage = new LogStorage();
  storage.add(createTestEntry({ type: "tool_call", success: true }));
  storage.add(createTestEntry({ type: "error", success: false, error: "Test error" }));

  const markdown = storage.exportMarkdown();

  assertExists(markdown);
  assertEquals(markdown.includes("# Operation Log"), true);
  assertEquals(markdown.includes("✓"), true);
  assertEquals(markdown.includes("✗"), true);
  assertEquals(markdown.includes("Test error"), true);
});

Deno.test("LogStorage - getToolLogs filters correctly", () => {
  const storage = new LogStorage();

  storage.add(createTestEntry({ type: "tool_call" }));
  storage.add(createTestEntry({ type: "tool_result" }));
  storage.add(createTestEntry({ type: "llm_request" }));

  const toolLogs = storage.getToolLogs();
  assertEquals(toolLogs.length, 2);
});

Deno.test("LogStorage - getLLMLogs filters correctly", () => {
  const storage = new LogStorage();

  storage.add(createTestEntry({ type: "tool_call" }));
  storage.add(createTestEntry({ type: "llm_request", level: "llm" }));
  storage.add(createTestEntry({ type: "llm_response", level: "llm" }));

  const llmLogs = storage.getLLMLogs();
  assertEquals(llmLogs.length, 2);
});
