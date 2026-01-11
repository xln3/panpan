/**
 * LLM Provider abstraction types
 * Supports multiple providers: OpenAI, Anthropic, etc.
 */

import type { Tool } from "./tool.ts";
import type { ContentBlock, TokenUsage } from "./message.ts";

/** Supported provider types */
export type ProviderType = "openai" | "anthropic";

/** Provider configuration */
export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** Extended thinking config (Anthropic only) */
  thinking?: {
    enabled: boolean;
    budgetTokens?: number; // Default: 10000
  };
  /** Explicit provider type (overrides auto-detection) */
  providerType?: ProviderType;
}

/** Internal message format for provider input */
export interface InternalMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/** Completion request (provider-agnostic) */
export interface CompletionRequest {
  messages: InternalMessage[];
  systemPrompt: string[];
  tools: Tool[];
  maxTokens?: number;
  temperature?: number;
}

/** Completion response (normalized to internal format) */
export interface CompletionResponse {
  id: string;
  content: ContentBlock[];
  usage?: TokenUsage;
  finishReason: "stop" | "tool_use" | "length" | "error";
}

/** Provider interface - what each provider must implement */
export interface LLMProvider {
  readonly providerType: ProviderType;

  /** Make a completion request */
  complete(
    request: CompletionRequest,
    signal: AbortSignal,
  ): Promise<CompletionResponse>;
}
