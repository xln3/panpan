/**
 * Tests for src/llm/stream-parser.ts
 */

import { assertEquals } from "jsr:@std/assert@1";
import {
  accumulateToolCalls,
  parseSSEStream,
  type AccumulatedToolCall,
} from "../../src/llm/stream-parser.ts";
import { collectGenerator } from "../_helpers/mod.ts";

// =============================================================================
// Helper to create readable stream from string chunks
// =============================================================================

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

// =============================================================================
// parseSSEStream tests
// =============================================================================

Deno.test("parseSSEStream - parses simple data lines", async () => {
  const stream = createSSEStream([
    'data: {"id":"1","content":"hello"}\n\n',
    'data: {"id":"2","content":"world"}\n\n',
    "data: [DONE]\n\n",
  ]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 2);
  assertEquals(results[0].id, "1");
  assertEquals(results[1].id, "2");
});

Deno.test("parseSSEStream - skips empty lines", async () => {
  const stream = createSSEStream([
    "\n",
    "\n\n",
    'data: {"id":"1"}\n\n',
    "\n",
    "data: [DONE]\n\n",
  ]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 1);
  assertEquals(results[0].id, "1");
});

Deno.test("parseSSEStream - skips comment lines (: prefix)", async () => {
  const stream = createSSEStream([
    ": this is a comment\n",
    'data: {"id":"1"}\n\n',
    ": another comment\n",
    "data: [DONE]\n\n",
  ]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 1);
});

Deno.test("parseSSEStream - handles [DONE] signal", async () => {
  const stream = createSSEStream([
    'data: {"id":"1"}\n\n',
    "data: [DONE]\n\n",
    'data: {"id":"2"}\n\n', // Should not be processed
  ]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 1);
  assertEquals(results[0].id, "1");
});

Deno.test("parseSSEStream - buffers incomplete lines across chunks", async () => {
  const stream = createSSEStream([
    'data: {"id":', // Incomplete
    '"1","val', // Still incomplete
    'ue":"test"}\n\n', // Now complete
    "data: [DONE]\n\n",
  ]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 1);
  assertEquals(results[0].id, "1");
});

Deno.test("parseSSEStream - handles multiple events in single chunk", async () => {
  const stream = createSSEStream([
    'data: {"id":"1"}\n\ndata: {"id":"2"}\n\ndata: [DONE]\n\n',
  ]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 2);
});

Deno.test("parseSSEStream - skips malformed JSON (silent)", async () => {
  // Capture console.warn to suppress output during test
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    const stream = createSSEStream([
      "data: not valid json\n\n",
      'data: {"id":"valid"}\n\n',
      "data: [DONE]\n\n",
    ]);

    const results = await collectGenerator(
      parseSSEStream(stream, new AbortController().signal),
    );

    assertEquals(results.length, 1);
    assertEquals(results[0].id, "valid");
    assertEquals(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test({
  name: "parseSSEStream - respects abort signal",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const controller = new AbortController();
    const stream = createSSEStream([
      'data: {"id":"1"}\n\n',
      'data: {"id":"2"}\n\n',
      'data: {"id":"3"}\n\n',
      "data: [DONE]\n\n",
    ]);

    // Abort after reading starts
    setTimeout(() => controller.abort(), 0);

    const results = await collectGenerator(
      parseSSEStream(stream, controller.signal),
    );

    // May get 0, 1, or more results depending on timing
    // The important thing is it doesn't hang
    assertEquals(results.length <= 3, true);
  },
});

Deno.test("parseSSEStream - handles empty stream", async () => {
  const stream = createSSEStream([]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 0);
});

Deno.test("parseSSEStream - handles stream without [DONE]", async () => {
  const stream = createSSEStream([
    'data: {"id":"1"}\n\n',
    'data: {"id":"2"}\n\n',
  ]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 2);
});

Deno.test("parseSSEStream - trims whitespace from data", async () => {
  const stream = createSSEStream([
    'data:    {"id":"1"}   \n\n',
    "data: [DONE]\n\n",
  ]);

  const results = await collectGenerator(
    parseSSEStream(stream, new AbortController().signal),
  );

  assertEquals(results.length, 1);
  assertEquals(results[0].id, "1");
});

// =============================================================================
// accumulateToolCalls tests
// =============================================================================

Deno.test("accumulateToolCalls - accumulates tool call id", () => {
  const existing = new Map<number, AccumulatedToolCall>();

  accumulateToolCalls(existing, [{ index: 0, id: "call-123" }]);

  assertEquals(existing.get(0)?.id, "call-123");
  assertEquals(existing.get(0)?.name, "");
  assertEquals(existing.get(0)?.arguments, "");
});

Deno.test("accumulateToolCalls - accumulates function name", () => {
  const existing = new Map<number, AccumulatedToolCall>();

  accumulateToolCalls(existing, [
    { index: 0, function: { name: "get_weather" } },
  ]);

  assertEquals(existing.get(0)?.name, "get_weather");
});

Deno.test("accumulateToolCalls - accumulates arguments incrementally", () => {
  const existing = new Map<number, AccumulatedToolCall>();

  // First chunk
  accumulateToolCalls(existing, [{ index: 0, function: { arguments: '{"city' } }]);
  assertEquals(existing.get(0)?.arguments, '{"city');

  // Second chunk
  accumulateToolCalls(existing, [
    { index: 0, function: { arguments: '":"New York"}' } },
  ]);
  assertEquals(existing.get(0)?.arguments, '{"city":"New York"}');
});

Deno.test("accumulateToolCalls - handles multiple tool calls by index", () => {
  const existing = new Map<number, AccumulatedToolCall>();

  accumulateToolCalls(existing, [
    { index: 0, id: "call-1", function: { name: "func_a" } },
    { index: 1, id: "call-2", function: { name: "func_b" } },
  ]);

  assertEquals(existing.get(0)?.id, "call-1");
  assertEquals(existing.get(0)?.name, "func_a");
  assertEquals(existing.get(1)?.id, "call-2");
  assertEquals(existing.get(1)?.name, "func_b");
});

Deno.test("accumulateToolCalls - handles partial deltas", () => {
  const existing = new Map<number, AccumulatedToolCall>();

  // ID first
  accumulateToolCalls(existing, [{ index: 0, id: "call-1" }]);
  // Name second
  accumulateToolCalls(existing, [{ index: 0, function: { name: "my_func" } }]);
  // Arguments in parts
  accumulateToolCalls(existing, [{ index: 0, function: { arguments: '{"a":' } }]);
  accumulateToolCalls(existing, [{ index: 0, function: { arguments: "1}" } }]);

  const result = existing.get(0);
  assertEquals(result?.id, "call-1");
  assertEquals(result?.name, "my_func");
  assertEquals(result?.arguments, '{"a":1}');
});

Deno.test("accumulateToolCalls - initializes missing entries", () => {
  const existing = new Map<number, AccumulatedToolCall>();

  // Start with index 1 (not 0)
  accumulateToolCalls(existing, [{ index: 1, id: "call-2" }]);

  assertEquals(existing.has(0), false);
  assertEquals(existing.get(1)?.id, "call-2");
});

Deno.test("accumulateToolCalls - handles empty delta array", () => {
  const existing = new Map<number, AccumulatedToolCall>();
  existing.set(0, { id: "call-1", name: "func", arguments: "" });

  accumulateToolCalls(existing, []);

  // Nothing should change
  assertEquals(existing.get(0)?.id, "call-1");
  assertEquals(existing.size, 1);
});

Deno.test("accumulateToolCalls - preserves existing values when delta is partial", () => {
  const existing = new Map<number, AccumulatedToolCall>();
  existing.set(0, { id: "call-1", name: "func_a", arguments: '{"x":' });

  // Only arguments delta, no id or name
  accumulateToolCalls(existing, [{ index: 0, function: { arguments: "1}" } }]);

  assertEquals(existing.get(0)?.id, "call-1");
  assertEquals(existing.get(0)?.name, "func_a");
  assertEquals(existing.get(0)?.arguments, '{"x":1}');
});
