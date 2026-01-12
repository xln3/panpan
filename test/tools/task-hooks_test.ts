/**
 * Tests for SA (Subagent) hooks integration in task.ts
 * Verifies that hooks are called correctly when spawning subagents
 *
 * Note: Full integration tests are complex because task.ts creates its own LLMClient.
 * These tests verify the hooks are properly wired by testing error paths and
 * verifying logs are created.
 */

import { assertEquals } from "@std/assert";
import { loggerService } from "../../src/services/mod.ts";

// =============================================================================
// Setup/Teardown helpers
// =============================================================================

function resetLogger(): void {
  loggerService.reset();
  loggerService.initialize({ defaultLevel: "full" });
}

// =============================================================================
// SA hooks type verification tests
// =============================================================================

Deno.test("SA hooks - loggerService exports getHooks method", () => {
  resetLogger();

  const hooks = loggerService.getHooks();

  // Verify SA-specific hooks exist
  assertEquals(
    typeof hooks.onSAInvoke,
    "function",
    "Should have onSAInvoke hook",
  );
  assertEquals(
    typeof hooks.onSAComplete,
    "function",
    "Should have onSAComplete hook",
  );

  loggerService.reset();
});

Deno.test("SA hooks - onSAInvoke logs sa_invoke event", () => {
  resetLogger();

  const hooks = loggerService.getHooks();

  // Manually call the hook to verify it logs correctly
  hooks.onSAInvoke("TestAgent", "Test prompt for agent");

  const logs = loggerService.getAll();
  const saInvokeLogs = logs.filter((log) => log.type === "sa_invoke");

  assertEquals(saInvokeLogs.length > 0, true, "Should have logged SA invoke");

  // Verify data structure
  const invokeLog = saInvokeLogs[0];
  assertEquals(
    (invokeLog.data as { agentType?: string })?.agentType,
    "TestAgent",
    "Should log agent type",
  );

  loggerService.reset();
});

Deno.test("SA hooks - onSAComplete logs sa_result event", () => {
  resetLogger();

  const hooks = loggerService.getHooks();

  // Manually call the hook to verify it logs correctly
  hooks.onSAComplete(
    "TestAgent",
    "Agent completed successfully with this result",
  );

  const logs = loggerService.getAll();
  const saResultLogs = logs.filter((log) => log.type === "sa_result");

  assertEquals(saResultLogs.length > 0, true, "Should have logged SA result");

  // Verify data structure
  const resultLog = saResultLogs[0];
  assertEquals(
    (resultLog.data as { agentType?: string })?.agentType,
    "TestAgent",
    "Should log agent type",
  );
  assertEquals(
    (resultLog.data as { resultLength?: number })?.resultLength,
    "Agent completed successfully with this result".length,
    "Should log result length",
  );

  loggerService.reset();
});

Deno.test("SA hooks - onSAInvoke logs at summary level", () => {
  loggerService.reset();
  loggerService.initialize({ defaultLevel: "summary" });

  const hooks = loggerService.getHooks();

  hooks.onSAInvoke("Explore", "Find all TypeScript files");

  const logs = loggerService.getAll();
  const summaryLogs = logs.filter(
    (log) => log.level === "summary" && log.type === "sa_invoke",
  );

  assertEquals(
    summaryLogs.length > 0,
    true,
    "Should log SA invoke at summary level",
  );

  loggerService.reset();
});

Deno.test("SA hooks - tool level logs include more detail", () => {
  loggerService.reset();
  loggerService.initialize({ defaultLevel: "tool" });

  const hooks = loggerService.getHooks();

  hooks.onSAInvoke("Plan", "Design implementation for feature X");
  hooks.onSAComplete("Plan", "Implementation plan with 5 steps");

  const logs = loggerService.getAll();

  // At tool level, should have both invoke and result logs
  const toolLevelLogs = logs.filter((log) => log.level === "tool");

  assertEquals(
    toolLevelLogs.length >= 2,
    true,
    "Should have tool level logs for invoke and complete",
  );

  // Invoke log should have prompt length
  const invokeLog = toolLevelLogs.find((log) => log.type === "sa_invoke");
  assertEquals(
    (invokeLog?.data as { promptLength?: number })?.promptLength,
    "Design implementation for feature X".length,
    "Should include prompt length",
  );

  loggerService.reset();
});

Deno.test("SA hooks - error logging via onToolError", () => {
  resetLogger();

  const hooks = loggerService.getHooks();

  // SA errors are logged via onToolError with "SA:" prefix
  hooks.onToolError("SA:Explore", new Error("Connection timeout"));

  const logs = loggerService.getAll();
  const errorLogs = logs.filter((log) => log.success === false);

  assertEquals(errorLogs.length > 0, true, "Should have logged error");

  // Verify error details
  const errorLog = errorLogs[0];
  assertEquals(
    errorLog.error?.includes("Connection timeout"),
    true,
    "Should include error message",
  );

  loggerService.reset();
});

// =============================================================================
// Static verification - verifies task.ts uses loggerService
// =============================================================================

Deno.test("SA hooks - task.ts source contains loggerService import", async () => {
  // Read the source file and verify it imports and uses loggerService
  // This is a static check that doesn't require loading the module (which has heavy deps)
  const sourceCode = await Deno.readTextFile(
    new URL("../../src/tools/task.ts", import.meta.url),
  );

  // Verify import statement exists
  assertEquals(
    sourceCode.includes('import { loggerService } from "../services/mod.ts"'),
    true,
    "Should import loggerService from services/mod.ts",
  );

  // Verify hooks are used
  assertEquals(
    sourceCode.includes("loggerService.getHooks()"),
    true,
    "Should call loggerService.getHooks()",
  );

  // Verify SA hooks are called
  assertEquals(
    sourceCode.includes("hooks.onSAInvoke"),
    true,
    "Should call hooks.onSAInvoke",
  );

  assertEquals(
    sourceCode.includes("hooks.onSAComplete"),
    true,
    "Should call hooks.onSAComplete",
  );
});
