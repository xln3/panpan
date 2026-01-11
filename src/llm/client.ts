/**
 * LLM client with multi-provider support
 * Automatically selects provider based on model name
 */

import type { Tool } from "../types/tool.ts";
import type { LLMConfig } from "../types/llm.ts";
import type {
  CompletionResponse,
  InternalMessage,
  LLMProvider,
} from "../types/provider.ts";
import { createProvider } from "./provider-factory.ts";

export class LLMClient {
  private provider: LLMProvider;

  constructor(private config: LLMConfig) {
    this.provider = createProvider(config);
  }

  /**
   * Complete chat and return normalized response
   */
  async complete(
    messages: InternalMessage[],
    systemPrompt: string[],
    tools: Tool[],
    signal: AbortSignal,
  ): Promise<CompletionResponse> {
    return this.provider.complete(
      {
        messages,
        systemPrompt,
        tools,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      },
      signal,
    );
  }

  /**
   * Get the detected provider type
   */
  get providerType() {
    return this.provider.providerType;
  }
}
