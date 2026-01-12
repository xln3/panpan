/**
 * Mock LLM client for testing
 */

import type { LLMClient } from "../../src/llm/client.ts";
import type {
  CompletionResponse,
  InternalMessage,
} from "../../src/types/provider.ts";
import type { Tool } from "../../src/types/tool.ts";

type ResponseProvider =
  | CompletionResponse[]
  | ((messages: InternalMessage[]) => CompletionResponse);

/**
 * Create a mock LLM client for testing
 *
 * @param responses - Array of responses to return in sequence, or a function
 */
export function createMockLLMClient(
  responses: ResponseProvider,
): LLMClient {
  let callIndex = 0;
  const calls: Array<{
    messages: InternalMessage[];
    systemPrompt: string[];
    tools: Tool[];
  }> = [];

  const mock = {
    complete: async (
      messages: InternalMessage[],
      systemPrompt: string[],
      tools: Tool[],
      signal: AbortSignal,
    ): Promise<CompletionResponse> => {
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      calls.push({ messages, systemPrompt, tools });

      if (typeof responses === "function") {
        return await Promise.resolve(responses(messages));
      }

      const response = responses[callIndex++];
      if (!response) {
        return await Promise.resolve(responses[responses.length - 1]);
      }
      return await Promise.resolve(response);
    },
    providerType: "openai" as const,

    // Test helpers
    getCalls: () => calls,
    getCallCount: () => callIndex,
  };

  return mock as unknown as LLMClient;
}

/**
 * Create a simple text response
 */
export function createTextResponse(
  text: string,
  options: Partial<CompletionResponse> = {},
): CompletionResponse {
  return {
    id: `resp-${Date.now()}`,
    content: [{ type: "text", text }],
    finishReason: "stop",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
    },
    ...options,
  };
}

/**
 * Create a tool use response
 */
export function createToolUseResponse(
  toolCalls: Array<
    { id: string; name: string; input: Record<string, unknown> }
  >,
  options: Partial<CompletionResponse> = {},
): CompletionResponse {
  return {
    id: `resp-${Date.now()}`,
    content: toolCalls.map((tc) => ({
      type: "tool_use" as const,
      id: tc.id,
      name: tc.name,
      input: tc.input,
    })),
    finishReason: "tool_use",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
    },
    ...options,
  };
}
