/**
 * Tests for logger hooks integration in query.ts
 * Verifies that hooks are called correctly during query execution
 */

import { assertEquals } from "@std/assert";
import { query, type QueryContext } from "../../src/core/query.ts";
import { createUserMessage } from "../../src/core/messages.ts";
import { createMockLLMClient, createTextResponse } from "../_mocks/mod.ts";
import { collectGenerator } from "../_helpers/mod.ts";
import { loggerService } from "../../src/services/mod.ts";
import type { Message } from "../../src/types/message.ts";

// =============================================================================
// Setup/Teardown helpers
// =============================================================================

function resetLogger(): void {
  loggerService.reset();
  loggerService.initialize({ defaultLevel: "full" });
}

function createQueryContext(
  overrides: Partial<QueryContext> = {},
): QueryContext {
  return {
    abortController: new AbortController(),
    tools: [],
    readFileTimestamps: {},
    cwd: "/tmp",
    ...overrides,
  };
}

// =============================================================================
// Hook integration tests
// =============================================================================

Deno.test("query hooks - calls onQueryStart at beginning", async () => {
  resetLogger();

  const llmClient = createMockLLMClient([
    createTextResponse("Hello, world!"),
  ]);

  const messages: Message[] = [createUserMessage("Hi")];
  const context = createQueryContext();

  await collectGenerator(
    query(messages, ["You are helpful"], llmClient, context),
  );

  // Check logs contain query start event (user_input type at full level)
  const logs = loggerService.getAll();
  const queryStartLogs = logs.filter((log) => log.type === "user_input");

  assertEquals(
    queryStartLogs.length > 0,
    true,
    "Should have logged query start",
  );

  loggerService.reset();
});

Deno.test("query hooks - calls onLLMRequest before API call", async () => {
  resetLogger();

  const llmClient = createMockLLMClient([
    createTextResponse("Response"),
  ]);

  const messages: Message[] = [createUserMessage("Test message")];
  const context = createQueryContext();

  await collectGenerator(
    query(messages, ["System prompt"], llmClient, context),
  );

  // Check logs contain LLM request event
  const logs = loggerService.getAll();
  const llmRequestLogs = logs.filter((log) => log.type === "llm_request");

  assertEquals(
    llmRequestLogs.length > 0,
    true,
    "Should have logged LLM request",
  );

  loggerService.reset();
});

Deno.test("query hooks - calls onLLMResponse after API response", async () => {
  resetLogger();

  const llmClient = createMockLLMClient([
    createTextResponse("API Response"),
  ]);

  const messages: Message[] = [createUserMessage("Query")];
  const context = createQueryContext();

  await collectGenerator(query(messages, [], llmClient, context));

  // Check logs contain LLM response event
  const logs = loggerService.getAll();
  const llmResponseLogs = logs.filter((log) => log.type === "llm_response");

  assertEquals(
    llmResponseLogs.length > 0,
    true,
    "Should have logged LLM response",
  );

  // Should have duration
  const responseLog = llmResponseLogs[0];
  assertEquals(
    responseLog.duration !== undefined,
    true,
    "Should have duration",
  );
  assertEquals(
    responseLog.duration! >= 0,
    true,
    "Duration should be non-negative",
  );

  loggerService.reset();
});

Deno.test("query hooks - calls onQueryEnd for final response (no tools)", async () => {
  resetLogger();

  const llmClient = createMockLLMClient([
    createTextResponse("Final answer"),
  ]);

  const messages: Message[] = [createUserMessage("Question")];
  const context = createQueryContext();

  await collectGenerator(query(messages, [], llmClient, context));

  // When no tool calls, should have query end logged (as llm_response with completed flag)
  const logs = loggerService.getAll();
  const queryEndLogs = logs.filter(
    (log) =>
      log.type === "llm_response" &&
      (log.data as { completed?: boolean })?.completed === true,
  );

  assertEquals(queryEndLogs.length > 0, true, "Should have logged query end");

  loggerService.reset();
});

Deno.test("query hooks - logs summary level events", async () => {
  loggerService.reset();
  loggerService.initialize({ defaultLevel: "summary" });

  const llmClient = createMockLLMClient([
    createTextResponse("Summary response"),
  ]);

  const messages: Message[] = [createUserMessage("Test")];
  const context = createQueryContext();

  await collectGenerator(query(messages, [], llmClient, context));

  // At summary level, should still have LLM call summary
  const logs = loggerService.getAll();
  const summaryLogs = logs.filter((log) => log.level === "summary");

  assertEquals(summaryLogs.length > 0, true, "Should have summary level logs");

  loggerService.reset();
});

Deno.test("query hooks - respects log level filtering", async () => {
  loggerService.reset();
  loggerService.initialize({ defaultLevel: "summary" });

  const llmClient = createMockLLMClient([
    createTextResponse("Response"),
  ]);

  const messages: Message[] = [createUserMessage("Test")];
  const context = createQueryContext();

  await collectGenerator(query(messages, [], llmClient, context));

  // At summary level, should NOT have full level logs like user_input
  const logs = loggerService.getAll();
  const fullLevelLogs = logs.filter((log) => log.level === "full");

  assertEquals(
    fullLevelLogs.length,
    0,
    "Should not have full level logs at summary level",
  );

  loggerService.reset();
});

Deno.test("query hooks - does not log when aborted early", async () => {
  resetLogger();

  const llmClient = createMockLLMClient([
    createTextResponse("Should not see this"),
  ]);

  const controller = new AbortController();
  controller.abort(); // Pre-aborted

  const messages: Message[] = [createUserMessage("Test")];
  const context = createQueryContext({ abortController: controller });

  await collectGenerator(query(messages, [], llmClient, context));

  // When aborted before start, should have minimal logs
  const logs = loggerService.getAll();

  // May have query start but no LLM request/response
  const llmLogs = logs.filter((log) =>
    log.type === "llm_request" || log.type === "llm_response"
  );
  assertEquals(llmLogs.length, 0, "Should not have LLM logs when aborted");

  loggerService.reset();
});
