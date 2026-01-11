/**
 * OpenAI-compatible API types
 * Supports any OpenAI-compatible endpoint (OpenAI, AiHubMix, ZhipuAI, etc.)
 */

import type { TokenUsage } from "./message.ts";
import type { ProviderType } from "./provider.ts";

/** LLM client configuration */
export interface LLMConfig {
  /** API base URL (e.g., "https://api.openai.com/v1" or "https://aihubmix.com/v1") */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** Model name */
  model: string;
  /** Max tokens to generate */
  maxTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** Extended thinking config (Anthropic only) */
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;
  };
  /** Explicit provider type (overrides auto-detection) */
  providerType?: ProviderType;
}

/** Chat message for API */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** Tool call from assistant */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/** Tool definition for API */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  };
}

/** Chat completion request */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | "required";
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

/** Chat completion response (non-streaming) */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: TokenUsage;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    reasoning_content?: string | null; // Claude thinking content
    tool_calls?: ToolCall[];
  };
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter";
}

/** Streaming chunk */
export interface StreamingChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: StreamingChoice[];
  usage?: TokenUsage;
}

export interface StreamingChoice {
  index: number;
  delta: {
    role?: "assistant";
    content?: string;
    reasoning_content?: string; // Claude thinking content via proxies
    tool_calls?: StreamingToolCall[];
  };
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null;
}

export interface StreamingToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}
