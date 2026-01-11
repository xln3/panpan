/**
 * Message rendering utilities
 */

import * as colors from "@std/fmt/colors";
import type {
  AssistantMessage,
  ContentBlock,
  Message,
  UserMessage,
} from "../types/message.ts";

/**
 * Render a message for terminal display
 */
export function renderMessage(message: Message): string {
  switch (message.type) {
    case "user":
      return renderUserMessage(message);
    case "assistant":
      return renderAssistantMessage(message);
    case "progress":
      return colors.dim(`[Progress: ${message.content}]`);
    default:
      return "";
  }
}

/**
 * Render a user message
 */
function renderUserMessage(message: UserMessage): string {
  const content = message.message.content;

  if (typeof content === "string") {
    return colors.green(`> ${content}`);
  }

  // Handle tool results
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(colors.green(`> ${block.text}`));
    } else if (block.type === "tool_result") {
      const preview = block.content.slice(0, 200);
      const truncated = block.content.length > 200 ? "..." : "";
      if (block.is_error) {
        parts.push(colors.red(`[Error] ${preview}${truncated}`));
      } else {
        parts.push(colors.dim(`[Result] ${preview}${truncated}`));
      }
    }
  }

  return parts.join("\n");
}

/**
 * Render an assistant message
 */
function renderAssistantMessage(message: AssistantMessage): string {
  const parts: string[] = [];

  for (const block of message.message.content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "tool_use") {
      parts.push(renderToolUse(block));
    }
  }

  return parts.join("\n");
}

/**
 * Render a tool use block
 */
function renderToolUse(block: ContentBlock): string {
  if (block.type !== "tool_use") return "";

  const lines: string[] = [];
  lines.push(colors.yellow(`[Tool: ${block.name}]`));

  // Pretty-print the input
  const inputStr = JSON.stringify(block.input, null, 2);
  const inputLines = inputStr.split("\n");

  // Truncate if too long
  if (inputLines.length > 10) {
    lines.push(colors.dim(inputLines.slice(0, 10).join("\n")));
    lines.push(colors.dim("..."));
  } else {
    lines.push(colors.dim(inputStr));
  }

  return lines.join("\n");
}

/**
 * Render tool result for display
 */
export function renderToolResult(
  toolUseId: string,
  content: string,
  isError: boolean,
): string {
  const preview = content.slice(0, 500);
  const truncated = content.length > 500 ? "\n..." : "";

  if (isError) {
    return colors.red(`[Error: ${toolUseId}]\n${preview}${truncated}`);
  }

  return colors.dim(`[Result: ${toolUseId}]\n${preview}${truncated}`);
}

/**
 * Format cost for display
 */
export function formatCost(costUSD: number): string {
  if (costUSD < 0.001) {
    return `$${(costUSD * 1000).toFixed(3)}m`;
  }
  return `$${costUSD.toFixed(4)}`;
}

/**
 * Format duration for display
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
