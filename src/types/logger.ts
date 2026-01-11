/**
 * Logger types for objective recording of agent activities.
 * Used by LoggerSA to capture tool calls, LLM interactions, and failures.
 */

/**
 * Logging verbosity levels
 */
export type LogLevel = "summary" | "tool" | "llm" | "full";

/**
 * Types of log entries
 */
export type LogEntryType =
  | "user_input"
  | "llm_request"
  | "llm_response"
  | "tool_call"
  | "tool_result"
  | "sa_invoke"
  | "sa_result"
  | "diagnosis"
  | "fix_attempt"
  | "abort"
  | "error";

/**
 * Base log entry structure
 */
export interface LogEntry {
  /** Unique identifier for this entry */
  id: string;
  /** Minimum log level at which this entry is visible */
  level: LogLevel;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Type of this log entry */
  type: LogEntryType;
  /** Entry-specific data */
  data: unknown;
  /** Duration in milliseconds (for timed operations) */
  duration?: number;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
}

/**
 * High-level summary log entry (visible at "summary" level)
 */
export interface SummaryLogEntry {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Brief description of the action */
  action: string;
  /** Whether the action succeeded */
  success: boolean;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Tool execution log entry (visible at "tool" level and above)
 */
export interface ToolLogEntry extends LogEntry {
  type: "tool_call" | "tool_result";
  data: {
    /** Name of the tool */
    toolName: string;
    /** Tool input parameters */
    input: Record<string, unknown>;
    /** Tool output (for tool_result entries) */
    output?: unknown;
    /** Execution duration in milliseconds */
    durationMs: number;
  };
}

/**
 * LLM interaction log entry (visible at "llm" level and above)
 */
export interface LLMLogEntry extends LogEntry {
  type: "llm_request" | "llm_response";
  data: {
    /** Model name/ID used */
    model: string;
    /** Token usage statistics */
    tokens: { prompt: number; completion: number };
    /** Estimated cost in dollars */
    cost: number;
    /** Response content (truncated for large responses) */
    content?: string;
  };
}

/**
 * Analysis of a failure point for debugging
 */
export interface FailurePoint {
  /** ID of the log entry where failure occurred */
  entryId: string;
  /** Type of operation that failed */
  type: string;
  /** Error message or description */
  error: string;
  /** Context around the failure */
  context: {
    /** Summary of steps leading to failure */
    previousSteps: string[];
    /** Relevant tool state at time of failure */
    toolState: Record<string, unknown>;
  };
  /** Suggested fixes based on failure analysis */
  suggestedFixes: string[];
}

/**
 * Hooks for Logger to intercept events during execution.
 * Implementations should be non-blocking.
 */
export interface LoggerHooks {
  /** Called when a new query loop starts */
  onQueryStart(messages: unknown[]): void;
  /** Called before sending a request to the LLM */
  onLLMRequest(messages: unknown[], systemPrompt: string[]): void;
  /** Called after receiving a response from the LLM */
  onLLMResponse(response: unknown, durationMs: number): void;
  /** Called when a query loop ends */
  onQueryEnd(finalMessage: unknown): void;
  /** Called when a tool execution starts */
  onToolStart(toolName: string, input: unknown): void;
  /** Called for streaming tool progress updates */
  onToolProgress(toolName: string, progress: string): void;
  /** Called when a tool execution completes */
  onToolComplete(toolName: string, result: unknown, durationMs: number): void;
  /** Called when a tool execution fails */
  onToolError(toolName: string, error: Error): void;
  /** Called when a subagent is invoked */
  onSAInvoke(agentType: string, prompt: string): void;
  /** Called when a subagent completes */
  onSAComplete(agentType: string, result: string): void;
  /** Called when execution is aborted */
  onAbort(reason: string): void;
}
