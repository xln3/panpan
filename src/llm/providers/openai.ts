/**
 * OpenAI-compatible LLM provider
 * Supports OpenAI, AiHubMix (OpenAI mode), and other OpenAI-compatible endpoints
 */

import { z } from "zod";
import type { Tool } from "../../types/tool.ts";
import type { ContentBlock } from "../../types/message.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  InternalMessage,
  LLMProvider,
  ProviderConfig,
} from "../../types/provider.ts";

/** OpenAI chat message format */
interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** OpenAI tool call format */
interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** OpenAI tool definition format */
interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** OpenAI API response */
interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
  };
}

export class OpenAIProvider implements LLMProvider {
  readonly providerType = "openai" as const;

  constructor(private config: ProviderConfig) {}

  async complete(
    request: CompletionRequest,
    signal: AbortSignal,
  ): Promise<CompletionResponse> {
    const messages = this.formatMessages(
      request.messages,
      request.systemPrompt,
    );
    const tools = this.formatTools(request.tools);

    // Normalize base URL - remove trailing slash if present
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");

    const response = await fetch(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? "auto" : undefined,
          max_tokens: request.maxTokens ?? this.config.maxTokens ?? 8192,
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          stream: false,
        }),
        signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    const result = (await response.json()) as OpenAIResponse;
    return this.normalizeResponse(result);
  }

  private formatMessages(
    messages: InternalMessage[],
    systemPrompt: string[],
  ): OpenAIChatMessage[] {
    const result: OpenAIChatMessage[] = [];

    // Add system prompt as first message
    const combinedSystemPrompt = systemPrompt.join("\n\n");
    if (combinedSystemPrompt) {
      result.push({
        role: "system",
        content: combinedSystemPrompt,
      });
    }

    // Convert internal messages to OpenAI format
    for (const msg of messages) {
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          result.push({ role: "user", content: msg.content });
        } else {
          // Check if this contains tool results
          const toolResults = msg.content.filter((b) =>
            b.type === "tool_result"
          );
          if (toolResults.length > 0) {
            // Add each tool result as separate tool message
            for (const tr of toolResults) {
              if (tr.type === "tool_result") {
                result.push({
                  role: "tool",
                  content: tr.content,
                  tool_call_id: tr.tool_use_id,
                });
              }
            }
          } else {
            // Regular content - join text blocks
            const textContent = msg.content
              .filter((b) => b.type === "text")
              .map((b) => (b as { type: "text"; text: string }).text)
              .join("");
            if (textContent) {
              result.push({ role: "user", content: textContent });
            }
          }
        }
      } else if (msg.role === "assistant") {
        if (typeof msg.content === "string") {
          result.push({ role: "assistant", content: msg.content });
        } else {
          // Extract text content
          const textContent = msg.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { type: "text"; text: string }).text)
            .join("");

          // Extract tool calls
          const toolCalls = msg.content
            .filter((b) => b.type === "tool_use")
            .map((b) => {
              const tu = b as {
                type: "tool_use";
                id: string;
                name: string;
                input: Record<string, unknown>;
              };
              return {
                id: tu.id,
                type: "function" as const,
                function: {
                  name: tu.name,
                  arguments: JSON.stringify(tu.input),
                },
              };
            });

          result.push({
            role: "assistant",
            content: textContent || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        }
      }
    }

    return result;
  }

  private formatTools(tools: Tool[]): OpenAIToolDefinition[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
      },
    }));
  }

  private normalizeResponse(raw: OpenAIResponse): CompletionResponse {
    const choice = raw.choices[0];
    const content: ContentBlock[] = [];

    // Handle reasoning_content (Claude via proxy)
    if (choice.message.reasoning_content) {
      content.push({
        type: "thinking",
        thinking: choice.message.reasoning_content,
      });
    }

    // Handle text content
    if (choice.message.content) {
      content.push({
        type: "text",
        text: choice.message.content,
      });
    }

    // Handle tool calls
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          // Keep empty object on parse failure
        }

        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    return {
      id: raw.id,
      content,
      usage: raw.usage,
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  private mapFinishReason(
    reason: string,
  ): CompletionResponse["finishReason"] {
    switch (reason) {
      case "tool_calls":
        return "tool_use";
      case "length":
        return "length";
      case "stop":
        return "stop";
      default:
        return "stop";
    }
  }
}
