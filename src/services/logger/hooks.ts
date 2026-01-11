/**
 * Logger hooks factory - creates hooks for intercepting events during execution.
 * Hooks are non-blocking and filter entries based on current log level.
 */

import type { LoggerHooks, LogEntry, LogLevel, LogEntryType } from "../../types/logger.ts";
import { LogStorage } from "./log-storage.ts";

/**
 * Priority mapping for log levels (lower = more visible)
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  summary: 0,
  tool: 1,
  llm: 2,
  full: 3,
};

/**
 * Create logger hooks that write to the given storage
 */
export function createLoggerHooks(
  storage: LogStorage,
  getCurrentLevel: () => LogLevel
): LoggerHooks {
  /**
   * Check if a log level should be recorded at the current level
   */
  const shouldLog = (level: LogLevel): boolean => {
    return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[getCurrentLevel()];
  };

  /**
   * Create a log entry with common fields
   */
  const createEntry = (
    level: LogLevel,
    type: LogEntryType,
    data: unknown,
    success = true,
    error?: string,
    duration?: number
  ): LogEntry => ({
    id: crypto.randomUUID(),
    level,
    timestamp: Date.now(),
    type,
    data,
    success,
    error,
    duration,
  });

  return {
    onQueryStart(messages: unknown[]): void {
      if (shouldLog("full")) {
        storage.add(createEntry("full", "user_input", {
          messageCount: Array.isArray(messages) ? messages.length : 0,
          messages,
        }));
      }
    },

    onLLMRequest(messages: unknown[], systemPrompt: string[]): void {
      if (shouldLog("llm")) {
        storage.add(createEntry("llm", "llm_request", {
          messageCount: Array.isArray(messages) ? messages.length : 0,
          systemPromptLength: systemPrompt.join("").length,
        }));
      }
    },

    onLLMResponse(response: unknown, durationMs: number): void {
      if (shouldLog("llm")) {
        const entry = createEntry("llm", "llm_response", {
          hasContent: !!(response as Record<string, unknown>)?.content,
          durationMs,
        }, true, undefined, durationMs);
        storage.add(entry);
      }

      // Always log at summary level for LLM calls
      if (shouldLog("summary")) {
        storage.add(createEntry("summary", "llm_response", {
          action: "LLM call",
        }, true, undefined, durationMs));
      }
    },

    onQueryEnd(finalMessage: unknown): void {
      if (shouldLog("full")) {
        storage.add(createEntry("full", "llm_response", {
          finalMessage,
          completed: true,
        }));
      }
    },

    onToolStart(toolName: string, input: unknown): void {
      if (shouldLog("tool")) {
        storage.add(createEntry("tool", "tool_call", {
          toolName,
          input,
          startTime: Date.now(),
        }));
      }
    },

    onToolProgress(toolName: string, progress: string): void {
      if (shouldLog("full")) {
        storage.add(createEntry("full", "tool_call", {
          toolName,
          progress,
          streaming: true,
        }));
      }
    },

    onToolComplete(toolName: string, result: unknown, durationMs: number): void {
      if (shouldLog("tool")) {
        const truncatedResult = typeof result === "string" && result.length > 500
          ? result.slice(0, 500) + "..."
          : result;

        const entry = createEntry("tool", "tool_result", {
          toolName,
          result: truncatedResult,
          durationMs,
        }, true, undefined, durationMs);
        storage.add(entry);
      }

      // Summary level
      if (shouldLog("summary")) {
        storage.add(createEntry("summary", "tool_result", {
          action: `Tool: ${toolName}`,
        }, true, undefined, durationMs));
      }
    },

    onToolError(toolName: string, error: Error): void {
      // Errors are always logged at tool level
      const entry = createEntry("tool", "tool_result", {
        toolName,
        error: error.message,
      }, false, error.message);
      storage.add(entry);

      // Also log at summary level
      storage.add(createEntry("summary", "error", {
        action: `Tool error: ${toolName}`,
        error: error.message,
      }, false, error.message));
    },

    onSAInvoke(agentType: string, prompt: string): void {
      if (shouldLog("tool")) {
        storage.add(createEntry("tool", "sa_invoke", {
          agentType,
          promptLength: prompt.length,
        }));
      }

      if (shouldLog("summary")) {
        storage.add(createEntry("summary", "sa_invoke", {
          action: `Subagent: ${agentType}`,
        }));
      }
    },

    onSAComplete(agentType: string, result: string): void {
      if (shouldLog("tool")) {
        storage.add(createEntry("tool", "sa_result", {
          agentType,
          resultLength: result.length,
        }));
      }
    },

    onAbort(reason: string): void {
      // Aborts are always logged
      storage.add(createEntry("summary", "abort", {
        reason,
      }, false, reason));
    },
  };
}
