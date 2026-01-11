/**
 * Tests for src/core/messages.ts
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import {
  createAssistantMessage,
  createProgressMessage,
  createTextAssistantMessage,
  createUserMessage,
  getToolUseBlocks,
  normalizeMessagesForAPI,
} from "../../src/core/messages.ts";
import type {
  AssistantMessage,
  ContentBlock,
  Message,
  UserMessage,
} from "../../src/types/message.ts";
import type { CompletionResponse } from "../../src/types/provider.ts";

// =============================================================================
// createUserMessage tests
// =============================================================================

Deno.test("createUserMessage - creates message from string", () => {
  const msg = createUserMessage("Hello, world!");

  assertEquals(msg.type, "user");
  assertEquals(msg.message.role, "user");
  assertEquals(msg.message.content, "Hello, world!");
  assertNotEquals(msg.uuid, "");
});

Deno.test("createUserMessage - creates message from ContentBlock[]", () => {
  const blocks: ContentBlock[] = [
    { type: "text", text: "Some text" },
    { type: "tool_result", tool_use_id: "123", content: "Result" },
  ];

  const msg = createUserMessage(blocks);

  assertEquals(msg.type, "user");
  assertEquals(msg.message.content, blocks);
});

Deno.test("createUserMessage - generates unique uuid", () => {
  const msg1 = createUserMessage("Test 1");
  const msg2 = createUserMessage("Test 2");

  assertNotEquals(msg1.uuid, msg2.uuid);
});

// =============================================================================
// createAssistantMessage tests
// =============================================================================

Deno.test("createAssistantMessage - creates message from response", () => {
  const response: CompletionResponse = {
    id: "resp-123",
    content: [{ type: "text", text: "Hello!" }],
    finishReason: "stop",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
    },
  };

  const msg = createAssistantMessage(response, 500);

  assertEquals(msg.type, "assistant");
  assertEquals(msg.message.role, "assistant");
  assertEquals(msg.message.content, response.content);
  assertEquals(msg.durationMs, 500);
  assertEquals(msg.usage, response.usage);
});

Deno.test("createAssistantMessage - calculates cost from usage", () => {
  const response: CompletionResponse = {
    id: "resp-123",
    content: [{ type: "text", text: "Hello!" }],
    finishReason: "stop",
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 500,
    },
  };

  const msg = createAssistantMessage(response, 100);

  // Cost = prompt * 0.00003 + completion * 0.00006
  // = 1000 * 0.00003 + 500 * 0.00006
  // = 0.03 + 0.03 = 0.06
  // Use approximate comparison for floating point
  const expectedCost = 0.06;
  assertEquals(Math.abs(msg.costUSD - expectedCost) < 0.0001, true);
});

Deno.test("createAssistantMessage - handles missing usage", () => {
  const response: CompletionResponse = {
    id: "resp-123",
    content: [{ type: "text", text: "Hello!" }],
    finishReason: "stop",
  };

  const msg = createAssistantMessage(response, 100);

  assertEquals(msg.costUSD, 0);
  assertEquals(msg.usage, undefined);
});

// =============================================================================
// createTextAssistantMessage tests
// =============================================================================

Deno.test("createTextAssistantMessage - creates simple text message", () => {
  const msg = createTextAssistantMessage("Simple response");

  assertEquals(msg.type, "assistant");
  assertEquals(msg.message.content.length, 1);
  assertEquals(msg.message.content[0].type, "text");
  assertEquals((msg.message.content[0] as { text: string }).text, "Simple response");
  assertEquals(msg.costUSD, 0);
  assertEquals(msg.durationMs, 0);
});

// =============================================================================
// createProgressMessage tests
// =============================================================================

Deno.test("createProgressMessage - creates progress message", () => {
  const msg = createProgressMessage("tool-123", "Processing...");

  assertEquals(msg.type, "progress");
  assertEquals(msg.toolUseId, "tool-123");
  assertEquals(msg.content, "Processing...");
  assertNotEquals(msg.uuid, "");
});

// =============================================================================
// normalizeMessagesForAPI tests
// =============================================================================

Deno.test("normalizeMessagesForAPI - filters out progress messages", () => {
  const messages: Message[] = [
    createUserMessage("Hello"),
    {
      type: "progress",
      uuid: "p1",
      toolUseId: "t1",
      content: "Working...",
    },
    createTextAssistantMessage("Response"),
  ];

  const result = normalizeMessagesForAPI(messages);

  assertEquals(result.length, 2);
  assertEquals(result[0].role, "user");
  assertEquals(result[1].role, "assistant");
});

Deno.test("normalizeMessagesForAPI - keeps user string content as-is", () => {
  const messages: Message[] = [createUserMessage("Hello, world!")];

  const result = normalizeMessagesForAPI(messages);

  assertEquals(result.length, 1);
  assertEquals(result[0].content, "Hello, world!");
});

Deno.test("normalizeMessagesForAPI - keeps user ContentBlock[] content", () => {
  const blocks: ContentBlock[] = [
    { type: "text", text: "Some text" },
    { type: "tool_result", tool_use_id: "123", content: "Result" },
  ];
  const messages: Message[] = [createUserMessage(blocks)];

  const result = normalizeMessagesForAPI(messages);

  assertEquals(result.length, 1);
  assertEquals(Array.isArray(result[0].content), true);
  assertEquals((result[0].content as ContentBlock[]).length, 2);
});

Deno.test("normalizeMessagesForAPI - keeps assistant messages as-is", () => {
  const messages: Message[] = [
    createTextAssistantMessage("Hello!"),
  ];

  const result = normalizeMessagesForAPI(messages);

  assertEquals(result.length, 1);
  assertEquals(result[0].role, "assistant");
});

// =============================================================================
// cleanupOrphanedToolUses tests (via normalizeMessagesForAPI)
// =============================================================================

function createAssistantWithToolUse(toolUseId: string): AssistantMessage {
  return {
    type: "assistant",
    uuid: crypto.randomUUID(),
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Let me help you." },
        {
          type: "tool_use",
          id: toolUseId,
          name: "TestTool",
          input: { arg: "value" },
        },
      ],
    },
    costUSD: 0,
    durationMs: 100,
  };
}

function createUserWithToolResult(toolUseId: string): UserMessage {
  return createUserMessage([
    {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: "Tool result content",
    },
  ]);
}

Deno.test("normalizeMessagesForAPI - keeps tool_use with matching tool_result", () => {
  const messages: Message[] = [
    createAssistantWithToolUse("tool-1"),
    createUserWithToolResult("tool-1"),
  ];

  const result = normalizeMessagesForAPI(messages);

  assertEquals(result.length, 2);
  const assistantContent = result[0].content as ContentBlock[];
  const hasToolUse = assistantContent.some((b) => b.type === "tool_use");
  assertEquals(hasToolUse, true);
});

Deno.test("normalizeMessagesForAPI - removes orphaned tool_use without any results", () => {
  const messages: Message[] = [
    createAssistantWithToolUse("tool-1"),
    // No tool_result follows
    createUserMessage("Next message"),
  ];

  const result = normalizeMessagesForAPI(messages);

  // Assistant message should only have text block (tool_use removed)
  const assistantContent = result[0].content as ContentBlock[];
  const hasToolUse = assistantContent.some((b) => b.type === "tool_use");
  assertEquals(hasToolUse, false);
  assertEquals(assistantContent.length, 1);
  assertEquals(assistantContent[0].type, "text");
});

Deno.test("normalizeMessagesForAPI - drops message entirely if only tool_use", () => {
  const assistantOnlyToolUse: AssistantMessage = {
    type: "assistant",
    uuid: crypto.randomUUID(),
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "TestTool",
          input: {},
        },
      ],
    },
    costUSD: 0,
    durationMs: 100,
  };

  const messages: Message[] = [
    assistantOnlyToolUse,
    createUserMessage("No result provided"),
  ];

  const result = normalizeMessagesForAPI(messages);

  // Assistant message should be dropped entirely
  assertEquals(result.length, 1);
  assertEquals(result[0].role, "user");
});

Deno.test("normalizeMessagesForAPI - adds dummy error results for partial tool results", () => {
  const assistantMultiTool: AssistantMessage = {
    type: "assistant",
    uuid: crypto.randomUUID(),
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "tool-1", name: "Tool1", input: {} },
        { type: "tool_use", id: "tool-2", name: "Tool2", input: {} },
      ],
    },
    costUSD: 0,
    durationMs: 100,
  };

  const messages: Message[] = [
    assistantMultiTool,
    // Only tool-1 has result, tool-2 is missing
    createUserWithToolResult("tool-1"),
  ];

  const result = normalizeMessagesForAPI(messages);

  // Should have: assistant, user (dummy for tool-2), user (original with tool-1)
  // The dummy is inserted right after the assistant in cleanupOrphanedToolUses
  assertEquals(result.length, 3);

  // Check dummy error result (comes right after assistant)
  const dummyUser = result[1];
  assertEquals(dummyUser.role, "user");
  const dummyContent = dummyUser.content as ContentBlock[];
  assertEquals(dummyContent.length, 1);
  assertEquals(dummyContent[0].type, "tool_result");
  assertEquals((dummyContent[0] as { tool_use_id: string }).tool_use_id, "tool-2");
  assertEquals((dummyContent[0] as { is_error?: boolean }).is_error, true);
});

Deno.test("normalizeMessagesForAPI - preserves text blocks when tool_use removed", () => {
  const messages: Message[] = [
    createAssistantWithToolUse("tool-1"),
    // No tool_result
  ];

  const result = normalizeMessagesForAPI(messages);

  assertEquals(result.length, 1);
  const content = result[0].content as ContentBlock[];
  assertEquals(content.length, 1);
  assertEquals(content[0].type, "text");
  assertEquals((content[0] as { text: string }).text, "Let me help you.");
});

Deno.test("normalizeMessagesForAPI - handles tool_result in later user message", () => {
  const messages: Message[] = [
    createAssistantWithToolUse("tool-1"),
    {
      type: "progress",
      uuid: "p1",
      toolUseId: "tool-1",
      content: "Working...",
    },
    createUserWithToolResult("tool-1"),
  ];

  const result = normalizeMessagesForAPI(messages);

  // Progress should be filtered, tool_use should remain
  assertEquals(result.length, 2);
  const assistantContent = result[0].content as ContentBlock[];
  const hasToolUse = assistantContent.some((b) => b.type === "tool_use");
  assertEquals(hasToolUse, true);
});

Deno.test("normalizeMessagesForAPI - stops at next assistant message for results", () => {
  const messages: Message[] = [
    createAssistantWithToolUse("tool-1"),
    // No tool_result before next assistant
    createTextAssistantMessage("Another response"),
    createUserWithToolResult("tool-1"), // Too late
  ];

  const result = normalizeMessagesForAPI(messages);

  // First assistant should have tool_use removed (result comes after next assistant)
  const firstAssistantContent = result[0].content as ContentBlock[];
  const hasToolUse = firstAssistantContent.some((b) => b.type === "tool_use");
  assertEquals(hasToolUse, false);
});

// =============================================================================
// getToolUseBlocks tests
// =============================================================================

Deno.test("getToolUseBlocks - extracts tool_use blocks only", () => {
  const msg: AssistantMessage = {
    type: "assistant",
    uuid: "test",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "tool_use", id: "t1", name: "Tool1", input: {} },
        { type: "thinking", thinking: "..." },
        { type: "tool_use", id: "t2", name: "Tool2", input: {} },
      ],
    },
    costUSD: 0,
    durationMs: 100,
  };

  const blocks = getToolUseBlocks(msg);

  assertEquals(blocks.length, 2);
  assertEquals(blocks[0].type, "tool_use");
  assertEquals(blocks[1].type, "tool_use");
});

Deno.test("getToolUseBlocks - returns empty array when no tool_use", () => {
  const msg: AssistantMessage = {
    type: "assistant",
    uuid: "test",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "thinking", thinking: "..." },
      ],
    },
    costUSD: 0,
    durationMs: 100,
  };

  const blocks = getToolUseBlocks(msg);

  assertEquals(blocks.length, 0);
});

Deno.test("getToolUseBlocks - ignores text and thinking blocks", () => {
  const msg: AssistantMessage = {
    type: "assistant",
    uuid: "test",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "thinking", thinking: "Let me think..." },
        { type: "text", text: "More text" },
      ],
    },
    costUSD: 0,
    durationMs: 100,
  };

  const blocks = getToolUseBlocks(msg);

  assertEquals(blocks.length, 0);
});

Deno.test("getToolUseBlocks - handles empty content array", () => {
  const msg: AssistantMessage = {
    type: "assistant",
    uuid: "test",
    message: {
      role: "assistant",
      content: [],
    },
    costUSD: 0,
    durationMs: 100,
  };

  const blocks = getToolUseBlocks(msg);

  assertEquals(blocks.length, 0);
});
