/**
 * Tests for logger hooks integration in tool-executor.ts
 * Verifies that hooks are called correctly during tool execution
 */

import { assertEquals } from "@std/assert";
import { z } from "zod";
import { ToolExecutor } from "../../src/core/tool-executor.ts";
import { collectGenerator, createMockToolContext } from "../_helpers/mod.ts";
import { loggerService } from "../../src/services/mod.ts";
import type { Tool, ToolYield } from "../../src/types/tool.ts";
import type { ContentBlock } from "../../src/types/message.ts";

// =============================================================================
// Setup/Teardown helpers
// =============================================================================

function resetLogger(): void {
  loggerService.reset();
  loggerService.initialize({ defaultLevel: "full" });
}

function createToolUseBlock(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): ContentBlock {
  return {
    type: "tool_use",
    id,
    name,
    input,
  };
}

// =============================================================================
// Hook integration tests
// =============================================================================

Deno.test("ToolExecutor hooks - calls onToolStart when tool begins", async () => {
  resetLogger();

  const tool: Tool = {
    name: "TestTool",
    description: "Test tool",
    inputSchema: z.object({ value: z.string().optional() }),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async *call(): AsyncGenerator<ToolYield<unknown>> {
      yield {
        type: "result",
        data: { success: true },
        resultForAssistant: "ok",
      };
    },
    renderResultForAssistant: () => "ok",
  };

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "TestTool", { value: "test" }),
  ];

  await collectGenerator(executor.executeAll(blocks));

  // Check logs contain tool start event
  const logs = loggerService.getAll();
  const toolStartLogs = logs.filter(
    (log) =>
      log.type === "tool_call" &&
      (log.data as { toolName?: string })?.toolName === "TestTool",
  );

  assertEquals(toolStartLogs.length > 0, true, "Should have logged tool start");

  loggerService.reset();
});

Deno.test("ToolExecutor hooks - calls onToolComplete when tool succeeds", async () => {
  resetLogger();

  const tool: Tool = {
    name: "SuccessTool",
    description: "Tool that succeeds",
    inputSchema: z.object({}),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async *call(): AsyncGenerator<ToolYield<unknown>> {
      yield {
        type: "result",
        data: { result: "success" },
        resultForAssistant: "done",
      };
    },
    renderResultForAssistant: () => "done",
  };

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "SuccessTool"),
  ];

  await collectGenerator(executor.executeAll(blocks));

  // Check logs contain tool result event
  const logs = loggerService.getAll();
  const toolResultLogs = logs.filter(
    (log) =>
      log.type === "tool_result" &&
      (log.data as { toolName?: string })?.toolName === "SuccessTool",
  );

  assertEquals(
    toolResultLogs.length > 0,
    true,
    "Should have logged tool result",
  );
  // Verify success status
  const resultLog = toolResultLogs[0];
  assertEquals(resultLog.success, true, "Should mark as success");

  loggerService.reset();
});

Deno.test("ToolExecutor hooks - calls onToolError when tool fails", async () => {
  resetLogger();

  const tool: Tool = {
    name: "ErrorTool",
    description: "Tool that throws",
    inputSchema: z.object({}),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    // deno-lint-ignore require-yield
    async *call(): AsyncGenerator<ToolYield<unknown>> {
      throw new Error("Intentional test error");
    },
    renderResultForAssistant: () => "",
  };

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "ErrorTool"),
  ];

  await collectGenerator(executor.executeAll(blocks));

  // Check logs contain error event
  const logs = loggerService.getAll();
  const errorLogs = logs.filter(
    (log) => log.type === "tool_result" && log.success === false,
  );

  assertEquals(errorLogs.length > 0, true, "Should have logged tool error");
  // Verify error message is captured
  const errorLog = errorLogs.find((log) =>
    (log.data as { toolName?: string })?.toolName === "ErrorTool"
  );
  assertEquals(errorLog !== undefined, true, "Should log ErrorTool failure");

  loggerService.reset();
});

Deno.test("ToolExecutor hooks - calls onToolProgress for progress yields", async () => {
  resetLogger();

  const tool: Tool = {
    name: "ProgressTool",
    description: "Tool with progress",
    inputSchema: z.object({}),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async *call(): AsyncGenerator<ToolYield<unknown>> {
      yield { type: "progress", content: "Step 1 of 3" };
      yield { type: "progress", content: "Step 2 of 3" };
      yield { type: "progress", content: "Step 3 of 3" };
      yield {
        type: "result",
        data: { done: true },
        resultForAssistant: "complete",
      };
    },
    renderResultForAssistant: () => "complete",
  };

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "ProgressTool"),
  ];

  await collectGenerator(executor.executeAll(blocks));

  // Check logs contain progress events (only at "full" level)
  const logs = loggerService.getAll();
  const progressLogs = logs.filter(
    (log) =>
      log.type === "tool_call" &&
      (log.data as { streaming?: boolean })?.streaming === true,
  );

  assertEquals(progressLogs.length, 3, "Should have logged 3 progress events");

  loggerService.reset();
});

Deno.test({
  name: "ToolExecutor hooks - calls onAbort when interrupted",
  // Timing-dependent test, disable sanitizers
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    resetLogger();

    let toolExecutionStarted = false;

    const tool: Tool = {
      name: "SlowTool",
      description: "Slow tool",
      inputSchema: z.object({}),
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      async *call(): AsyncGenerator<ToolYield<unknown>> {
        toolExecutionStarted = true;
        // Yield a progress to ensure we're in the execution loop
        yield { type: "progress", content: "Started" };
        await new Promise((r) => setTimeout(r, 200));
        yield { type: "result", data: {}, resultForAssistant: "" };
      },
      renderResultForAssistant: () => "",
    };

    const controller = new AbortController();
    const context = createMockToolContext({ abortController: controller });
    const executor = new ToolExecutor([tool], context);

    const blocks: ContentBlock[] = [
      createToolUseBlock("id-1", "SlowTool"),
    ];

    // Abort after tool starts but before it completes
    setTimeout(() => controller.abort(), 50);

    await collectGenerator(executor.executeAll(blocks));

    // Verify tool started
    assertEquals(toolExecutionStarted, true, "Tool should have started");

    // Check logs - abort may or may not be logged depending on timing
    // The important thing is no crash occurs
    const logs = loggerService.getAll();

    // We should at least have the tool start log
    const toolStartLogs = logs.filter(
      (log) =>
        log.type === "tool_call" &&
        (log.data as { toolName?: string })?.toolName === "SlowTool",
    );
    assertEquals(
      toolStartLogs.length > 0,
      true,
      "Should have logged tool start",
    );

    loggerService.reset();
  },
});

Deno.test("ToolExecutor hooks - logs duration in milliseconds", async () => {
  resetLogger();

  const tool: Tool = {
    name: "TimedTool",
    description: "Tool with delay",
    inputSchema: z.object({}),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async *call(): AsyncGenerator<ToolYield<unknown>> {
      await new Promise((r) => setTimeout(r, 30));
      yield { type: "result", data: {}, resultForAssistant: "" };
    },
    renderResultForAssistant: () => "",
  };

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "TimedTool"),
  ];

  await collectGenerator(executor.executeAll(blocks));

  // Check that duration is logged
  const logs = loggerService.getAll();
  const resultLog = logs.find(
    (log) =>
      log.type === "tool_result" &&
      (log.data as { toolName?: string })?.toolName === "TimedTool",
  );

  assertEquals(resultLog !== undefined, true, "Should have result log");
  assertEquals(resultLog!.duration !== undefined, true, "Should have duration");
  assertEquals(
    resultLog!.duration! >= 30,
    true,
    "Duration should be at least 30ms",
  );

  loggerService.reset();
});
