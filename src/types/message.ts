/**
 * Message types for panpan
 * Based on OpenAI chat completion format
 */

/** Content block types */
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  durationMs?: number;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;

/** Token usage tracking */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  // Anthropic cache stats
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** User message - either plain text or tool results */
export interface UserMessage {
  type: "user";
  uuid: string;
  message: {
    role: "user";
    content: string | ContentBlock[];
  };
}

/** Assistant message from LLM */
export interface AssistantMessage {
  type: "assistant";
  uuid: string;
  message: {
    role: "assistant";
    content: ContentBlock[];
  };
  usage?: TokenUsage;
  costUSD: number;
  durationMs: number;
}

/** Progress message during tool execution */
export interface ProgressMessage {
  type: "progress";
  uuid: string;
  toolUseId: string;
  content: string;
}

/** All message types */
export type Message = UserMessage | AssistantMessage | ProgressMessage;

/** Helper to generate UUID */
export function generateUUID(): string {
  return crypto.randomUUID();
}
