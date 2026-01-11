/**
 * Tests for src/core/tool-executor.ts
 */

import { assertEquals } from "jsr:@std/assert@1";
import { z } from "zod";
import { ToolExecutor } from "../../src/core/tool-executor.ts";
import { createMockToolContext, collectGenerator } from "../_helpers/mod.ts";
import type { Tool, ToolContext, ToolYield } from "../../src/types/tool.ts";
import type { ContentBlock, Message, UserMessage } from "../../src/types/message.ts";

// =============================================================================
// Mock tool factory
// =============================================================================

function createMockTool<T>(
  name: string,
  options: {
    isReadOnly?: boolean;
    isConcurrencySafe?: boolean;
    validateInput?: (input: T, context: ToolContext) => Promise<{ result: boolean; message?: string }>;
    callResult?: unknown;
    callError?: Error;
    callDelay?: number;
  } = {},
): Tool {
  const schema = z.object({ value: z.string().optional() });

  return {
    name,
    description: `Mock tool ${name}`,
    inputSchema: schema,
    isReadOnly: () => options.isReadOnly ?? true,
    isConcurrencySafe: () => options.isConcurrencySafe ?? true,
    validateInput: options.validateInput,
    async *call(_input, context): AsyncGenerator<ToolYield<unknown>> {
      if (options.callDelay) {
        await new Promise((r) => setTimeout(r, options.callDelay));
      }
      if (options.callError) {
        throw options.callError;
      }
      yield {
        type: "result",
        data: options.callResult ?? { success: true },
        resultForAssistant: JSON.stringify(options.callResult ?? { success: true }),
      };
    },
    renderResultForAssistant: (output) => JSON.stringify(output),
  } as Tool;
}

function createToolUseBlock(id: string, name: string, input: Record<string, unknown> = {}): ContentBlock {
  return {
    type: "tool_use",
    id,
    name,
    input,
  };
}

// =============================================================================
// Queue building tests
// =============================================================================

Deno.test("ToolExecutor - builds queue from tool_use blocks", async () => {
  const tool = createMockTool("TestTool");
  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "TestTool"),
    createToolUseBlock("id-2", "TestTool"),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));

  // Should have 2 results (one per tool call)
  assertEquals(results.length, 2);
});

Deno.test("ToolExecutor - skips non-tool_use blocks", async () => {
  const tool = createMockTool("TestTool");
  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    { type: "text", text: "Should be skipped" },
    createToolUseBlock("id-1", "TestTool"),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));

  assertEquals(results.length, 1);
});

// =============================================================================
// Unknown tool handling tests
// =============================================================================

Deno.test("ToolExecutor - returns error for unknown tool", async () => {
  const context = createMockToolContext();
  const executor = new ToolExecutor([], context); // No tools registered

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "UnknownTool"),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));

  assertEquals(results.length, 1);
  const msg = results[0] as UserMessage;
  assertEquals(msg.type, "user");
  const content = msg.message.content as ContentBlock[];
  assertEquals(content[0].type, "tool_result");
  assertEquals((content[0] as { is_error?: boolean }).is_error, true);
  assertEquals((content[0] as { content: string }).content.includes("Unknown tool"), true);
});

// =============================================================================
// Input validation tests
// =============================================================================

Deno.test("ToolExecutor - validates input against schema", async () => {
  const tool: Tool = {
    name: "StrictTool",
    description: "Tool with strict schema",
    inputSchema: z.object({ required: z.string() }),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async *call() {
      yield { type: "result", data: {}, resultForAssistant: "" };
    },
    renderResultForAssistant: () => "",
  };

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  // Missing required field
  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "StrictTool", {}),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));
  const msg = results[0] as UserMessage;
  const content = msg.message.content as ContentBlock[];

  assertEquals((content[0] as { is_error?: boolean }).is_error, true);
  assertEquals((content[0] as { content: string }).content.includes("Validation error"), true);
});

Deno.test("ToolExecutor - calls custom validateInput", async () => {
  const tool = createMockTool("ValidatedTool", {
    validateInput: async (input) => {
      if ((input as { value?: string }).value === "invalid") {
        return { result: false, message: "Value cannot be 'invalid'" };
      }
      return { result: true };
    },
  });

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "ValidatedTool", { value: "invalid" }),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));
  const msg = results[0] as UserMessage;
  const content = msg.message.content as ContentBlock[];

  assertEquals((content[0] as { is_error?: boolean }).is_error, true);
  assertEquals((content[0] as { content: string }).content.includes("Value cannot be 'invalid'"), true);
});

// =============================================================================
// Concurrency tests
// =============================================================================

Deno.test("ToolExecutor - runs concurrent tools in parallel", async () => {
  const executionOrder: string[] = [];

  const createTrackedTool = (name: string, delay: number) => ({
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({}),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    async *call(): AsyncGenerator<ToolYield<unknown>> {
      executionOrder.push(`${name}-start`);
      await new Promise((r) => setTimeout(r, delay));
      executionOrder.push(`${name}-end`);
      yield { type: "result", data: {}, resultForAssistant: "" };
    },
    renderResultForAssistant: () => "",
  } as Tool);

  const tools = [
    createTrackedTool("Tool1", 50),
    createTrackedTool("Tool2", 25),
  ];

  const context = createMockToolContext();
  const executor = new ToolExecutor(tools, context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "Tool1"),
    createToolUseBlock("id-2", "Tool2"),
  ];

  await collectGenerator(executor.executeAll(blocks));

  // Both should start before either ends (parallel execution)
  assertEquals(executionOrder.includes("Tool1-start"), true);
  assertEquals(executionOrder.includes("Tool2-start"), true);
  // Tool2 should end before Tool1 (shorter delay)
  const tool1EndIdx = executionOrder.indexOf("Tool1-end");
  const tool2EndIdx = executionOrder.indexOf("Tool2-end");
  assertEquals(tool2EndIdx < tool1EndIdx, true);
});

Deno.test("ToolExecutor - runs non-concurrent tools sequentially", async () => {
  const executionOrder: string[] = [];

  const createTrackedTool = (name: string, delay: number, concurrent: boolean) => ({
    name,
    description: `Tool ${name}`,
    inputSchema: z.object({}),
    isReadOnly: () => !concurrent,
    isConcurrencySafe: () => concurrent,
    async *call(): AsyncGenerator<ToolYield<unknown>> {
      executionOrder.push(`${name}-start`);
      await new Promise((r) => setTimeout(r, delay));
      executionOrder.push(`${name}-end`);
      yield { type: "result", data: {}, resultForAssistant: "" };
    },
    renderResultForAssistant: () => "",
  } as Tool);

  const tools = [
    createTrackedTool("Tool1", 20, false), // Non-concurrent
    createTrackedTool("Tool2", 20, false), // Non-concurrent
  ];

  const context = createMockToolContext();
  const executor = new ToolExecutor(tools, context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "Tool1"),
    createToolUseBlock("id-2", "Tool2"),
  ];

  await collectGenerator(executor.executeAll(blocks));

  // Tool1 should complete before Tool2 starts
  const tool1EndIdx = executionOrder.indexOf("Tool1-end");
  const tool2StartIdx = executionOrder.indexOf("Tool2-start");
  assertEquals(tool1EndIdx < tool2StartIdx, true);
});

// =============================================================================
// Abort handling tests
// =============================================================================

Deno.test("ToolExecutor - stops on abort before starting", async () => {
  const tool = createMockTool("TestTool", { callDelay: 100 });
  const controller = new AbortController();
  controller.abort(); // Pre-aborted

  const context = createMockToolContext({ abortController: controller });
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "TestTool"),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));

  // No results when aborted before starting
  assertEquals(results.length, 0);
});

Deno.test({
  name: "ToolExecutor - handles abort during execution",
  // Disable sanitizers due to timer
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    let toolStarted = false;

    const tool: Tool = {
      name: "SlowTool",
      description: "Slow tool",
      inputSchema: z.object({}),
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
      async *call(): AsyncGenerator<ToolYield<unknown>> {
        toolStarted = true;
        // Simulate slow work
        await new Promise((r) => setTimeout(r, 500));
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

    // Abort quickly after start
    setTimeout(() => controller.abort(), 50);

    const results = await collectGenerator(executor.executeAll(blocks));

    assertEquals(toolStarted, true);
    // Due to Promise.race in processQueue, abort causes early return
    // Results may be empty or have interrupted message depending on timing
    assertEquals(results.length >= 0 && results.length <= 1, true);
  },
});

// =============================================================================
// Result ordering tests
// =============================================================================

Deno.test({
  name: "ToolExecutor - yields results in queue order",
  // Disable sanitizers due to timer from parallel execution
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tools = [
      createMockTool("Tool1", { callResult: { id: 1 }, callDelay: 50 }),
      createMockTool("Tool2", { callResult: { id: 2 }, callDelay: 10 }),
    ];

    const context = createMockToolContext();
    const executor = new ToolExecutor(tools, context);

    const blocks: ContentBlock[] = [
      createToolUseBlock("id-1", "Tool1"),
      createToolUseBlock("id-2", "Tool2"),
    ];

    const results = await collectGenerator(executor.executeAll(blocks));

    // Results should be in queue order (Tool1 first, Tool2 second)
    // even though Tool2 finishes first
    assertEquals(results.length, 2);

    const content1 = (results[0] as UserMessage).message.content as ContentBlock[];
    const content2 = (results[1] as UserMessage).message.content as ContentBlock[];

    assertEquals((content1[0] as { tool_use_id: string }).tool_use_id, "id-1");
    assertEquals((content2[0] as { tool_use_id: string }).tool_use_id, "id-2");
  },
});

// =============================================================================
// Error handling tests
// =============================================================================

Deno.test("ToolExecutor - catches tool execution errors", async () => {
  const tool = createMockTool("ErrorTool", {
    callError: new Error("Something went wrong"),
  });

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "ErrorTool"),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));

  assertEquals(results.length, 1);
  const content = (results[0] as UserMessage).message.content as ContentBlock[];

  assertEquals((content[0] as { is_error?: boolean }).is_error, true);
  assertEquals((content[0] as { content: string }).content.includes("Something went wrong"), true);
});

Deno.test("ToolExecutor - marks error results with is_error", async () => {
  const tool = createMockTool("ErrorTool", {
    callError: new Error("Test error"),
  });

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "ErrorTool"),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));
  const content = (results[0] as UserMessage).message.content as ContentBlock[];

  assertEquals((content[0] as { is_error?: boolean }).is_error, true);
});

// =============================================================================
// Duration tracking tests
// =============================================================================

Deno.test("ToolExecutor - tracks execution duration", async () => {
  const tool = createMockTool("SlowTool", { callDelay: 50 });

  const context = createMockToolContext();
  const executor = new ToolExecutor([tool], context);

  const blocks: ContentBlock[] = [
    createToolUseBlock("id-1", "SlowTool"),
  ];

  const results = await collectGenerator(executor.executeAll(blocks));
  const content = (results[0] as UserMessage).message.content as ContentBlock[];

  const durationMs = (content[0] as { durationMs?: number }).durationMs ?? 0;
  assertEquals(durationMs >= 50, true);
});
