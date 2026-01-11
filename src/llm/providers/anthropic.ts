/**
 * Anthropic LLM provider
 * Supports native Anthropic API (Claude) via direct or AiHubMix Claude-Native endpoint
 * Includes prompt caching for reduced costs and latency
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

/** Cache control marker for prompt caching */
interface CacheControl {
  type: "ephemeral";
}

/** Anthropic content block types */
type AnthropicContentBlock =
  | { type: "text"; text: string; cache_control?: CacheControl }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/** System content block with optional cache control */
interface SystemContentBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

/** Anthropic message format */
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

/** Anthropic tool definition format with cache control */
interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
}

/** Anthropic API response */
interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly providerType = "anthropic" as const;

  constructor(private config: ProviderConfig) {}

  async complete(
    request: CompletionRequest,
    signal: AbortSignal,
  ): Promise<CompletionResponse> {
    const messages = this.formatMessages(request.messages);
    const tools = this.formatTools(request.tools);
    const system = this.formatSystemPrompt(request.systemPrompt);

    // Normalize base URL - remove trailing slash if present
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": "2023-06-01",
    };

    // Add beta header for interleaved thinking if enabled
    if (this.config.thinking?.enabled) {
      headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
    }

    // Build request body
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 8192,
      // Temperature must be 1 when thinking is enabled
      temperature: this.config.thinking?.enabled
        ? 1
        : (request.temperature ?? this.config.temperature),
      system: system.length > 0 ? system : undefined,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    };

    // Add thinking config if enabled
    if (this.config.thinking?.enabled) {
      body.thinking = {
        type: "enabled",
        budget_tokens: this.config.thinking.budgetTokens ?? 10000,
      };
    }

    const response = await fetch(
      `${baseUrl}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    const result = (await response.json()) as AnthropicResponse;
    return this.normalizeResponse(result);
  }

  /**
   * Format system prompt as content blocks with cache control
   * The last block gets cache_control to cache the entire system prompt
   */
  private formatSystemPrompt(systemPrompt: string[]): SystemContentBlock[] {
    if (systemPrompt.length === 0) {
      return [];
    }

    const combinedPrompt = systemPrompt.join("\n\n");
    if (!combinedPrompt) {
      return [];
    }

    // Return as content block with cache control
    return [
      {
        type: "text",
        text: combinedPrompt,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  private formatMessages(messages: InternalMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        result.push({
          role: msg.role,
          content: msg.content,
        });
      } else {
        // Convert ContentBlock[] to Anthropic format
        const content: AnthropicContentBlock[] = [];

        for (const block of msg.content) {
          if (block.type === "text") {
            content.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            content.push({
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input,
            });
          } else if (block.type === "tool_result") {
            content.push({
              type: "tool_result",
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            });
          }
          // Skip thinking blocks - they're output-only
        }

        if (content.length > 0) {
          result.push({ role: msg.role, content });
        }
      }
    }

    return result;
  }

  private formatTools(tools: Tool[]): AnthropicToolDefinition[] {
    return tools.map((tool, index) => {
      const schema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
      // Ensure schema has type: "object" - Anthropic requires this
      if (!schema.type) {
        schema.type = "object";
      }

      // Clean up schema for strict Anthropic validation (beta features)
      // Remove anyOf/oneOf/allOf which aren't supported at top level
      this.cleanupSchema(schema);

      const toolDef: AnthropicToolDefinition = {
        name: tool.name,
        description: tool.description,
        input_schema: schema,
      };

      // Add cache_control to the last tool to cache all tool definitions
      if (index === tools.length - 1) {
        toolDef.cache_control = { type: "ephemeral" };
      }

      return toolDef;
    });
  }

  /**
   * Clean up JSON schema for Anthropic's strict validation
   * Removes anyOf/oneOf/allOf at top level by merging properties
   */
  private cleanupSchema(schema: Record<string, unknown>): void {
    // Handle anyOf (from discriminated unions)
    if (Array.isArray(schema.anyOf)) {
      const merged = this.mergeSchemaVariants(schema.anyOf as Record<string, unknown>[]);
      delete schema.anyOf;
      Object.assign(schema, merged);
    }
    // Handle oneOf
    if (Array.isArray(schema.oneOf)) {
      const merged = this.mergeSchemaVariants(schema.oneOf as Record<string, unknown>[]);
      delete schema.oneOf;
      Object.assign(schema, merged);
    }
    // Handle allOf
    if (Array.isArray(schema.allOf)) {
      const merged = this.mergeSchemaVariants(schema.allOf as Record<string, unknown>[]);
      delete schema.allOf;
      Object.assign(schema, merged);
    }
  }

  /**
   * Merge multiple schema variants into a single permissive schema
   */
  private mergeSchemaVariants(variants: Record<string, unknown>[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {
      type: "object",
      properties: {},
      required: [],
    };

    const allProperties: Record<string, unknown> = {};
    const requiredSets: Set<string>[] = [];

    for (const variant of variants) {
      if (variant.properties && typeof variant.properties === "object") {
        Object.assign(allProperties, variant.properties);
      }
      if (Array.isArray(variant.required)) {
        requiredSets.push(new Set(variant.required as string[]));
      }
    }

    merged.properties = allProperties;

    // Only require fields that are required in ALL variants
    if (requiredSets.length > 0) {
      const commonRequired = [...requiredSets[0]].filter((field) =>
        requiredSets.every((set) => set.has(field))
      );
      merged.required = commonRequired;
    }

    return merged;
  }

  private normalizeResponse(raw: AnthropicResponse): CompletionResponse {
    const content: ContentBlock[] = [];

    // Anthropic returns content as array of blocks
    for (const block of raw.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        content.push({ type: "thinking", thinking: block.thinking });
      } else if (block.type === "tool_use") {
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    return {
      id: raw.id,
      content,
      usage: {
        prompt_tokens: raw.usage.input_tokens,
        completion_tokens: raw.usage.output_tokens,
        cache_creation_input_tokens: raw.usage.cache_creation_input_tokens,
        cache_read_input_tokens: raw.usage.cache_read_input_tokens,
      },
      finishReason: this.mapFinishReason(raw.stop_reason),
    };
  }

  private mapFinishReason(
    reason: AnthropicResponse["stop_reason"],
  ): CompletionResponse["finishReason"] {
    switch (reason) {
      case "tool_use":
        return "tool_use";
      case "max_tokens":
        return "length";
      case "end_turn":
      case "stop_sequence":
        return "stop";
      default:
        return "stop";
    }
  }
}
