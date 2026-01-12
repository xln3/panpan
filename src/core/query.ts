/**
 * Core query loop
 * The heart of panpan - recursive async generator for LLM interaction
 */

import type { Tool, ToolContext } from "../types/tool.ts";
import type { Message } from "../types/message.ts";
import type { LLMClient } from "../llm/client.ts";
import {
  createAssistantMessage,
  getToolUseBlocks,
  normalizeMessagesForAPI,
} from "./messages.ts";
import { ToolExecutor } from "./tool-executor.ts";
import { getPlanFilePath, isPlanMode } from "../utils/plan-mode.ts";
import { getReminderContents } from "../services/system-reminder.ts";
import { loggerService } from "../services/mod.ts";
import type { LLMConfig } from "../types/llm.ts";
import type { OutputDisplayController } from "../ui/output-display.ts";

export interface QueryContext {
  abortController: AbortController;
  tools: Tool[];
  readFileTimestamps: Record<string, number>;
  cwd: string;
  llmConfig?: LLMConfig; // For subagent tools like Task
  outputDisplay?: OutputDisplayController; // For streaming output display
}

/**
 * Get system prompt additions for plan mode
 */
function getPlanModeSystemPrompt(): string | null {
  if (!isPlanMode()) return null;

  const planFilePath = getPlanFilePath();
  return `
## Plan Mode Active

You are in plan mode. This means:

1. **Read-only exploration**: You can only use read-only tools (Read, Glob, Grep, WebFetch, WebSearch)
2. **Plan file only**: You can only edit the plan file at: ${planFilePath}
3. **No implementation**: Do NOT write code or make changes to the codebase yet

Your goal in plan mode:
- Explore the codebase to understand the current implementation
- Design an implementation approach
- Write your plan to the plan file
- Call ExitPlanMode when your plan is ready for user approval

Tools allowed in plan mode:
- Read-only: Read, Glob, Grep, WebFetch, WebSearch
- Special: TodoWrite, ExitPlanMode
- Edit: Only the plan file (${planFilePath})
`;
}

/**
 * Main query function
 * Recursive async generator that:
 * 1. Calls LLM
 * 2. If tool calls: execute tools, yield results, recurse
 * 3. If no tool calls: yield final response and return
 */
export async function* query(
  messages: Message[],
  systemPrompt: string[],
  llmClient: LLMClient,
  context: QueryContext,
): AsyncGenerator<Message> {
  // Get logger hooks for tracing
  const hooks = loggerService.getHooks();

  // Check for abort before starting
  if (context.abortController.signal.aborted) {
    // Don't yield message - the interrupt handler already showed "[Interrupted]"
    return;
  }

  // Log query start
  hooks.onQueryStart(messages);

  // Convert messages to API format
  const apiMessages = normalizeMessagesForAPI(messages);

  // Build system prompt with plan mode additions and reminders
  const planModePrompt = getPlanModeSystemPrompt();
  const reminderContents = getReminderContents();

  const fullSystemPrompt = [
    ...systemPrompt,
    ...(planModePrompt ? [planModePrompt] : []),
    ...reminderContents,
  ];

  // Log LLM request
  hooks.onLLMRequest(apiMessages, fullSystemPrompt);

  // Call LLM
  const startTime = Date.now();
  let response;

  try {
    response = await llmClient.complete(
      apiMessages,
      fullSystemPrompt,
      context.tools,
      context.abortController.signal,
    );
  } catch (error) {
    if (context.abortController.signal.aborted) {
      // Don't yield message - the interrupt handler already showed "[Interrupted]"
      return;
    }
    throw error;
  }

  const durationMs = Date.now() - startTime;

  // Log LLM response
  hooks.onLLMResponse(response, durationMs);

  // Check for abort after LLM response
  if (context.abortController.signal.aborted) {
    // Don't yield message - the interrupt handler already showed "[Interrupted]"
    return;
  }

  // Convert response to assistant message
  const assistantMessage = createAssistantMessage(response, durationMs);
  const toolUseBlocks = getToolUseBlocks(assistantMessage);

  // No tool calls - we're done
  if (toolUseBlocks.length === 0) {
    hooks.onQueryEnd(assistantMessage);
    yield assistantMessage;
    return;
  }

  // Has tool calls - yield assistant message, execute tools, recurse
  yield assistantMessage;

  // Create tool context
  const toolContext: ToolContext = {
    abortController: context.abortController,
    readFileTimestamps: context.readFileTimestamps,
    cwd: context.cwd,
    llmConfig: context.llmConfig,
    outputDisplay: context.outputDisplay,
  };

  // Execute tools
  const executor = new ToolExecutor(context.tools, toolContext);
  const toolResultMessages: Message[] = [];

  for await (const message of executor.executeAll(toolUseBlocks)) {
    yield message;
    if (message.type !== "progress") {
      toolResultMessages.push(message);
    }
  }

  // Check for abort after tool execution
  if (context.abortController.signal.aborted) {
    // Don't yield message - the interrupt handler already showed "[Interrupted]"
    return;
  }

  // Recurse with new messages
  yield* query(
    [...messages, assistantMessage, ...toolResultMessages],
    systemPrompt,
    llmClient,
    context,
  );
}
