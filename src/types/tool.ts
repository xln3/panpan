/**
 * Tool interface for panpan
 * Tools are async generators that can yield progress and results
 */

import type { z } from "zod";
import type { ContentBlock } from "./message.ts";
import type { LLMConfig } from "./llm.ts";
import type { OutputDisplayController } from "../ui/output-display.ts";

/**
 * Streaming output line from command execution
 */
export interface StreamingLine {
  stream: "stdout" | "stderr";
  line: string;
  timestamp: number;
}

/** Context passed to tool execution */
export interface ToolContext {
  abortController: AbortController;
  readFileTimestamps: Record<string, number>;
  cwd: string;
  llmConfig?: LLMConfig; // For subagent tools like Task
  outputDisplay?: OutputDisplayController; // For streaming output display
}

/** Tool execution result */
export interface ToolResult<T = unknown> {
  type: "result";
  data: T;
  resultForAssistant?: string | ContentBlock[];
}

/** Tool progress update */
export interface ToolProgress {
  type: "progress";
  content: string;
}

/** Tool streaming output (real-time command output) */
export interface ToolStreamingOutput {
  type: "streaming_output";
  line: StreamingLine;
}

/** Union of tool yields */
export type ToolYield<T = unknown> =
  | ToolResult<T>
  | ToolProgress
  | ToolStreamingOutput;

/** Input validation result */
export interface ValidationResult {
  result: boolean;
  message?: string;
}

/**
 * Tool definition interface
 * Generic over input schema (Zod) and output type
 */
export interface Tool<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = unknown,
> {
  /** Tool name (used in API) */
  name: string;

  /** Human-readable description */
  description: string;

  /** Zod schema for input validation */
  inputSchema: TInput;

  /** Whether this tool only reads (doesn't modify) */
  isReadOnly: (input?: z.infer<TInput>) => boolean;

  /** Whether this tool can run concurrently with others */
  isConcurrencySafe: (input?: z.infer<TInput>) => boolean;

  /** Optional input validation beyond schema */
  validateInput?: (
    input: z.infer<TInput>,
    context: ToolContext,
  ) => Promise<ValidationResult>;

  /** Execute the tool - async generator for streaming results */
  call: (
    input: z.infer<TInput>,
    context: ToolContext,
  ) => AsyncGenerator<ToolYield<TOutput>>;

  /** Format output for LLM consumption */
  renderResultForAssistant: (output: TOutput) => string;

  /**
   * Optional: Format tool use for human display
   * Returns a concise summary instead of raw JSON
   * If not implemented, falls back to JSON display
   */
  renderToolUseMessage?: (
    input: z.infer<TInput>,
    options: { verbose: boolean; cwd: string },
  ) => string | null;
}
