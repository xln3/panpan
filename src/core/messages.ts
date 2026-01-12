/**
 * Message creation utilities
 */

import type {
  AssistantMessage,
  ContentBlock,
  Message,
  ProgressMessage,
  UserMessage,
} from "../types/message.ts";
import { generateUUID } from "../types/message.ts";
import type { CompletionResponse, InternalMessage } from "../types/provider.ts";

/**
 * Create a user message from text
 */
export function createUserMessage(
  content: string | ContentBlock[],
): UserMessage {
  return {
    type: "user",
    uuid: generateUUID(),
    message: {
      role: "user",
      content,
    },
  };
}

/**
 * Create an assistant message from provider response
 */
export function createAssistantMessage(
  response: CompletionResponse,
  durationMs: number,
): AssistantMessage {
  // Calculate cost (rough estimate based on GPT-4 pricing)
  const usage = response.usage;
  const costUSD = usage
    ? (usage.prompt_tokens * 0.00003 + usage.completion_tokens * 0.00006)
    : 0;

  return {
    type: "assistant",
    uuid: generateUUID(),
    message: {
      role: "assistant",
      content: response.content,
    },
    usage,
    costUSD,
    durationMs,
  };
}

/**
 * Create a simple text assistant message
 */
export function createTextAssistantMessage(text: string): AssistantMessage {
  return {
    type: "assistant",
    uuid: generateUUID(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
    costUSD: 0,
    durationMs: 0,
  };
}

/**
 * Create a progress message
 */
export function createProgressMessage(
  toolUseId: string,
  content: string,
): ProgressMessage {
  return {
    type: "progress",
    uuid: generateUUID(),
    toolUseId,
    content,
  };
}

/**
 * Normalize internal messages to provider-agnostic format
 * Also validates that tool_use blocks have corresponding tool_results
 */
export function normalizeMessagesForAPI(
  messages: Message[],
): InternalMessage[] {
  // First, clean up any orphaned tool_use blocks
  const cleanedMessages = cleanupOrphanedToolUses(messages);

  const result: InternalMessage[] = [];

  for (const msg of cleanedMessages) {
    // Skip progress messages
    if (msg.type === "progress") {
      continue;
    }

    if (msg.type === "user") {
      const content = msg.message.content;

      if (typeof content === "string") {
        // Plain string content
        result.push({ role: "user", content });
      } else {
        // Array content - keep as ContentBlock[]
        // Filter out non-content blocks if needed
        const blocks = content.filter((b) =>
          b.type === "text" || b.type === "tool_result"
        );
        if (blocks.length > 0) {
          result.push({ role: "user", content: blocks });
        }
      }
    } else if (msg.type === "assistant") {
      // Keep content blocks as-is
      result.push({
        role: "assistant",
        content: msg.message.content,
      });
    }
  }

  return result;
}

/**
 * Clean up orphaned tool_use blocks that don't have corresponding tool_results
 * This can happen when the user interrupts a tool execution
 */
function cleanupOrphanedToolUses(messages: Message[]): Message[] {
  const result: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.type !== "assistant") {
      result.push(msg);
      continue;
    }

    // Get tool_use IDs from this assistant message
    const toolUseIds = new Set<string>();
    for (const block of msg.message.content) {
      if (block.type === "tool_use" && block.id) {
        toolUseIds.add(block.id);
      }
    }

    // If no tool_use blocks, just add the message
    if (toolUseIds.size === 0) {
      result.push(msg);
      continue;
    }

    // Collect tool_result IDs from following user messages
    const toolResultIds = new Set<string>();
    for (let j = i + 1; j < messages.length; j++) {
      const nextMsg = messages[j];
      if (nextMsg.type === "progress") continue;
      if (nextMsg.type === "assistant") break; // Stop at next assistant message

      if (nextMsg.type === "user" && Array.isArray(nextMsg.message.content)) {
        for (const block of nextMsg.message.content) {
          if (block.type === "tool_result" && block.tool_use_id) {
            toolResultIds.add(block.tool_use_id);
          }
        }
      }
    }

    // Check if all tool_use IDs have corresponding tool_results
    const missingResults: string[] = [];
    for (const id of toolUseIds) {
      if (!toolResultIds.has(id)) {
        missingResults.push(id);
      }
    }

    if (missingResults.length === 0) {
      // All tool_use blocks have results, keep the message
      result.push(msg);
    } else if (missingResults.length === toolUseIds.size) {
      // No tool results at all - this assistant message had tool calls but was interrupted
      // Remove tool_use blocks, keep only text content
      const textBlocks = msg.message.content.filter((b) => b.type === "text");
      if (textBlocks.length > 0) {
        result.push({
          ...msg,
          message: {
            ...msg.message,
            content: textBlocks,
          },
        });
      }
      // Skip this message entirely if it only had tool_use blocks
    } else {
      // Partial results - add dummy error results for missing ones
      result.push(msg);

      // Create dummy tool_result messages for missing IDs
      const dummyResults: ContentBlock[] = missingResults.map((id) => ({
        type: "tool_result" as const,
        tool_use_id: id,
        content: "Error: Tool execution was interrupted",
        is_error: true,
      }));

      result.push(createUserMessage(dummyResults));
    }
  }

  return result;
}

/**
 * Get tool use blocks from an assistant message
 */
export function getToolUseBlocks(message: AssistantMessage): ContentBlock[] {
  return message.message.content.filter((b) => b.type === "tool_use");
}
