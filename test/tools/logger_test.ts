/**
 * Tests for Logger Tools
 */

import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert@1";
import { LoggerConfigTool } from "../../src/tools/logger/logger-config.ts";
import { LoggerQueryTool } from "../../src/tools/logger/logger-query.ts";
import { LoggerExportTool, LoggerClearTool } from "../../src/tools/logger/logger-export.ts";
import { loggerService } from "../../src/services/logger/mod.ts";
import { collectGenerator, createMockToolContext, withTempDir } from "../_helpers/mod.ts";
import type { ToolYield } from "../../src/types/tool.ts";

// Type helper
function getResultData<T>(results: ToolYield<T>[]): T {
  const result = results.find(r => r.type === "result");
  if (!result || result.type !== "result") {
    throw new Error("Expected result type");
  }
  return result.data;
}

// Reset logger state before tests
function resetLoggerState() {
  loggerService.reset();
}

// ============================================================================
// LoggerConfigTool Tests
// ============================================================================

Deno.test("LoggerConfigTool - has correct metadata", () => {
  assertEquals(LoggerConfigTool.name, "LoggerConfig");
  assertEquals(LoggerConfigTool.isReadOnly(), false);
  assertEquals(LoggerConfigTool.isConcurrencySafe(), true);
});

Deno.test("LoggerConfigTool - changes log level", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerConfigTool.call({ level: "llm" }, context),
  );

  const data = getResultData(results);
  assertEquals(data.newLevel, "llm");
  assertEquals(loggerService.getLevel(), "llm");
});

Deno.test("LoggerConfigTool - returns previous level", async () => {
  resetLoggerState();
  loggerService.setLevel("summary");
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerConfigTool.call({ level: "full" }, context),
  );

  const data = getResultData(results);
  assertEquals(data.previousLevel, "summary");
  assertEquals(data.newLevel, "full");
});

Deno.test("LoggerConfigTool - renderResultForAssistant formats output", () => {
  const output = { previousLevel: "tool" as const, newLevel: "llm" as const };
  const result = LoggerConfigTool.renderResultForAssistant(output);
  assertStringIncludes(result, "tool");
  assertStringIncludes(result, "llm");
});

// ============================================================================
// LoggerQueryTool Tests
// ============================================================================

Deno.test("LoggerQueryTool - has correct metadata", () => {
  assertEquals(LoggerQueryTool.name, "LoggerQuery");
  assertEquals(LoggerQueryTool.isReadOnly(), true);
  assertEquals(LoggerQueryTool.isConcurrencySafe(), true);
});

Deno.test("LoggerQueryTool - summary format returns stats", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerQueryTool.call({ format: "summary", limit: 50, failures_only: false }, context),
  );

  const data = getResultData(results);
  assertEquals(data.format, "summary");
  assertExists(data.content);
});

Deno.test("LoggerQueryTool - timeline format returns chronological view", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerQueryTool.call({ format: "timeline", limit: 50, failures_only: false }, context),
  );

  const data = getResultData(results);
  assertEquals(data.format, "timeline");
  assertExists(data.content);
});

Deno.test("LoggerQueryTool - oneliner format returns brief summary", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerQueryTool.call({ format: "oneliner", limit: 50, failures_only: false }, context),
  );

  const data = getResultData(results);
  assertEquals(data.format, "oneliner");
  assertExists(data.content);
});

Deno.test("LoggerQueryTool - failures format analyzes errors", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerQueryTool.call({ format: "failures", limit: 50, failures_only: false }, context),
  );

  const data = getResultData(results);
  assertEquals(data.format, "failures");
  assertExists(data.content);
});

Deno.test("LoggerQueryTool - raw format returns JSON", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerQueryTool.call({ format: "raw", limit: 10, failures_only: false }, context),
  );

  const data = getResultData(results);
  assertEquals(data.format, "raw");
  // Should be valid JSON
  const parsed = JSON.parse(data.content);
  assertEquals(Array.isArray(parsed), true);
});

Deno.test("LoggerQueryTool - default format is summary", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerQueryTool.call({ format: "summary", limit: 50, failures_only: false }, context),
  );

  const data = getResultData(results);
  assertEquals(data.format, "summary");
});

// ============================================================================
// LoggerExportTool Tests
// ============================================================================

Deno.test("LoggerExportTool - has correct metadata", () => {
  assertEquals(LoggerExportTool.name, "LoggerExport");
  assertEquals(LoggerExportTool.isReadOnly(), false);
  assertEquals(LoggerExportTool.isConcurrencySafe(), false);
});

Deno.test("LoggerExportTool - exports to markdown", async () => {
  await withTempDir(async (dir: string) => {
    resetLoggerState();
    const context = createMockToolContext();
    const path = `${dir}/logs.md`;

    const results = await collectGenerator(
      LoggerExportTool.call({ format: "markdown", path }, context),
    );

    const data = getResultData(results);
    assertEquals(data.success, true);
    assertEquals(data.format, "markdown");
    assertEquals(data.path, path);

    // Verify file exists
    const stat = await Deno.stat(path);
    assertEquals(stat.isFile, true);
  });
});

Deno.test("LoggerExportTool - exports to json", async () => {
  await withTempDir(async (dir: string) => {
    resetLoggerState();
    const context = createMockToolContext();
    const path = `${dir}/logs.json`;

    const results = await collectGenerator(
      LoggerExportTool.call({ format: "json", path }, context),
    );

    const data = getResultData(results);
    assertEquals(data.success, true);
    assertEquals(data.format, "json");

    // Verify file is valid JSON
    const content = await Deno.readTextFile(path);
    const parsed = JSON.parse(content);
    assertEquals(Array.isArray(parsed), true);
  });
});

Deno.test("LoggerExportTool - creates parent directories", async () => {
  await withTempDir(async (dir: string) => {
    resetLoggerState();
    const context = createMockToolContext();
    const path = `${dir}/nested/deep/logs.md`;

    const results = await collectGenerator(
      LoggerExportTool.call({ format: "markdown", path }, context),
    );

    const data = getResultData(results);
    assertEquals(data.success, true);

    // Verify nested directories were created
    const stat = await Deno.stat(path);
    assertEquals(stat.isFile, true);
  });
});

Deno.test("LoggerExportTool - reports bytes written", async () => {
  await withTempDir(async (dir: string) => {
    resetLoggerState();
    const context = createMockToolContext();
    const path = `${dir}/logs.md`;

    const results = await collectGenerator(
      LoggerExportTool.call({ format: "markdown", path }, context),
    );

    const data = getResultData(results);
    assertEquals(data.bytesWritten > 0, true);
  });
});

// ============================================================================
// LoggerClearTool Tests
// ============================================================================

Deno.test("LoggerClearTool - has correct metadata", () => {
  assertEquals(LoggerClearTool.name, "LoggerClear");
  assertEquals(LoggerClearTool.isReadOnly(), false);
});

Deno.test("LoggerClearTool - requires confirmation", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerClearTool.call({ confirm: false }, context),
  );

  const data = getResultData(results);
  assertEquals(data.cleared, false);
});

Deno.test("LoggerClearTool - clears logs when confirmed", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    LoggerClearTool.call({ confirm: true }, context),
  );

  const data = getResultData(results);
  assertEquals(data.cleared, true);
  assertEquals(loggerService.size(), 0);
});

Deno.test("LoggerClearTool - reports previous count", async () => {
  resetLoggerState();
  const context = createMockToolContext();

  // Get initial count
  const initialCount = loggerService.size();

  const results = await collectGenerator(
    LoggerClearTool.call({ confirm: true }, context),
  );

  const data = getResultData(results);
  assertEquals(data.previousCount, initialCount);
});

// ============================================================================
// renderResultForAssistant Tests
// ============================================================================

Deno.test("LoggerQueryTool - renderResultForAssistant truncates long content", () => {
  const longContent = "x".repeat(5000);
  const output = { format: "raw", content: longContent, entryCount: 100 };
  const result = LoggerQueryTool.renderResultForAssistant(output);
  assertEquals(result.length < longContent.length, true);
  assertStringIncludes(result, "truncated");
});

Deno.test("LoggerExportTool - renderResultForAssistant formats success", () => {
  const output = {
    success: true,
    path: "/tmp/logs.md",
    format: "markdown",
    entryCount: 50,
    bytesWritten: 1234,
  };
  const result = LoggerExportTool.renderResultForAssistant(output);
  assertStringIncludes(result, "50");
  assertStringIncludes(result, "1234");
});

Deno.test("LoggerExportTool - renderResultForAssistant formats error", () => {
  const output = {
    success: false,
    path: "/invalid/path",
    format: "markdown",
    entryCount: 0,
    bytesWritten: 0,
    error: "Permission denied",
  };
  const result = LoggerExportTool.renderResultForAssistant(output);
  assertStringIncludes(result, "error");
  assertStringIncludes(result, "Permission denied");
});
