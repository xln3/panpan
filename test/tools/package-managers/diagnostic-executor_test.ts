/**
 * Tests for diagnostic-executor module
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import {
  executeWithDiagnostics,
  type DiagnosticResult,
  type DiagnosticProgress,
} from "../../../src/tools/package-managers/diagnostic-executor.ts";
import type { StreamingLine } from "../../../src/tools/package-managers/common.ts";

// Helper to collect generator results
async function collectResults<T>(
  gen: AsyncGenerator<T>
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

// Helper to extract final result from generator output
function extractDiagnosticResult(
  items: Array<StreamingLine | DiagnosticProgress | DiagnosticResult>
): DiagnosticResult | undefined {
  for (const item of items) {
    if ("attempts" in item) {
      return item as DiagnosticResult;
    }
  }
  return undefined;
}

// ============ Success on First Try ============

Deno.test("executeWithDiagnostics - success on first try returns attempts=1", async () => {
  const abortController = new AbortController();
  const cwd = Deno.cwd();

  const items = await collectResults(
    executeWithDiagnostics(
      ["echo", "hello"],
      cwd,
      5000,
      abortController,
      { tool: "pip" }
    )
  );

  const result = extractDiagnosticResult(items);
  assertExists(result);
  assertEquals(result.exitCode, 0);
  assertEquals(result.attempts, 1);
  assertEquals(result.appliedFixes.length, 0);
});

Deno.test("executeWithDiagnostics - captures stdout", async () => {
  const abortController = new AbortController();
  const cwd = Deno.cwd();

  const items = await collectResults(
    executeWithDiagnostics(
      ["echo", "test output"],
      cwd,
      5000,
      abortController,
      { tool: "pip" }
    )
  );

  const result = extractDiagnosticResult(items);
  assertExists(result);
  assertEquals(result.stdout.includes("test output"), true);
});

// ============ Streaming Output ============

Deno.test("executeWithDiagnostics - yields streaming lines", async () => {
  const abortController = new AbortController();
  const cwd = Deno.cwd();

  const items = await collectResults(
    executeWithDiagnostics(
      ["echo", "line1"],
      cwd,
      5000,
      abortController,
      { tool: "pip" }
    )
  );

  const streamingLines = items.filter((i): i is StreamingLine => "stream" in i);
  assertEquals(streamingLines.length > 0, true);
  assertEquals(streamingLines.some(l => l.line.includes("line1")), true);
});

// ============ Failure Handling ============

Deno.test("executeWithDiagnostics - failure returns diagnosis", async () => {
  const abortController = new AbortController();
  const cwd = Deno.cwd();

  // Command that will fail immediately (unknown error type)
  const items = await collectResults(
    executeWithDiagnostics(
      ["sh", "-c", "echo 'some unknown error' >&2 && exit 1"],
      cwd,
      5000,
      abortController,
      { tool: "pip", maxAttempts: 1 }
    )
  );

  const result = extractDiagnosticResult(items);
  assertExists(result);
  assertEquals(result.exitCode !== 0, true);
  assertEquals(result.attempts, 1);
  assertExists(result.diagnosis);
});

// ============ maxAttempts Configuration ============

Deno.test("executeWithDiagnostics - respects maxAttempts=1", async () => {
  const abortController = new AbortController();
  const cwd = Deno.cwd();

  const items = await collectResults(
    executeWithDiagnostics(
      ["sh", "-c", "exit 1"],
      cwd,
      5000,
      abortController,
      { tool: "pip", maxAttempts: 1 }
    )
  );

  const result = extractDiagnosticResult(items);
  assertExists(result);
  assertEquals(result.attempts, 1);
});

// ============ Tool Configuration ============

Deno.test("executeWithDiagnostics - accepts all tool types", async () => {
  const tools = ["pip", "conda", "uv", "pixi"] as const;
  const abortController = new AbortController();
  const cwd = Deno.cwd();

  for (const tool of tools) {
    const items = await collectResults(
      executeWithDiagnostics(
        ["echo", "ok"],
        cwd,
        5000,
        abortController,
        { tool }
      )
    );

    const result = extractDiagnosticResult(items);
    assertExists(result, `Failed for tool: ${tool}`);
    assertEquals(result.exitCode, 0, `Failed for tool: ${tool}`);
  }
});

// ============ Result Structure ============

Deno.test("executeWithDiagnostics - result has all required fields", async () => {
  const abortController = new AbortController();
  const cwd = Deno.cwd();

  const items = await collectResults(
    executeWithDiagnostics(
      ["echo", "test"],
      cwd,
      5000,
      abortController,
      { tool: "pip" }
    )
  );

  const result = extractDiagnosticResult(items);
  assertExists(result);

  // Check all CommandResult fields
  assertEquals(typeof result.stdout, "string");
  assertEquals(typeof result.stderr, "string");
  assertEquals(typeof result.exitCode, "number");
  assertEquals(typeof result.durationMs, "number");
  assertEquals(typeof result.timedOut, "boolean");

  // Check DiagnosticResult fields
  assertEquals(typeof result.attempts, "number");
  assertEquals(Array.isArray(result.appliedFixes), true);
});
