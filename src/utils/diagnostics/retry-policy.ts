/**
 * Retry policy and withRetry higher-order function.
 * Provides automatic retry with diagnosis and fix application.
 */

import type { ErrorDiagnosis, Fix } from "../../types/diagnostics.ts";
import { classifyError, type DiagnosticContext } from "./error-classifier.ts";
import { getPipMirrorEnv, getUvMirrorEnv } from "./config-detector.ts";

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay before first retry in milliseconds */
  initialDelayMs: number;
  /** Maximum delay between retries in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Context tracking retry state across attempts
 */
export interface RetryContext {
  /** Current attempt number (0-indexed) */
  attempt: number;
  /** Last error diagnosis */
  lastDiagnosis?: ErrorDiagnosis;
  /** IDs of fixes that have been applied */
  appliedFixes: string[];
  /** Total time spent in retries */
  totalDurationMs: number;
}

/**
 * Create a fresh retry context
 */
export function createRetryContext(): RetryContext {
  return {
    attempt: 0,
    appliedFixes: [],
    totalDurationMs: 0,
  };
}

/**
 * Determine if a retry should be attempted
 */
export function shouldRetry(
  context: RetryContext,
  diagnosis: ErrorDiagnosis,
  config: RetryConfig = DEFAULT_CONFIG
): { shouldRetry: boolean; nextFix?: Fix; delayMs: number } {
  // Max attempts reached
  if (context.attempt >= config.maxAttempts) {
    return { shouldRetry: false, delayMs: 0 };
  }

  // Not auto-fixable
  if (!diagnosis.autoFixable) {
    return { shouldRetry: false, delayMs: 0 };
  }

  // Find next untried fix
  const nextFix = diagnosis.suggestedFixes.find(
    (fix) => !context.appliedFixes.includes(fix.id)
  );

  if (!nextFix) {
    return { shouldRetry: false, delayMs: 0 };
  }

  // Calculate delay with exponential backoff
  const delayMs = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, context.attempt),
    config.maxDelayMs
  );

  return { shouldRetry: true, nextFix, delayMs };
}

/**
 * Apply a fix action
 */
export function applyFix(fix: Fix, context?: DiagnosticContext): void {
  switch (fix.action.type) {
    case "set_env":
      Deno.env.set(fix.action.key, fix.action.value);
      // Also set lowercase variant for compatibility
      Deno.env.set(fix.action.key.toLowerCase(), fix.action.value);
      break;

    case "use_mirror": {
      const mirrorUrl = fix.action.url;
      // Set tool-specific environment variables
      if (context?.tool === "pip") {
        const env = getPipMirrorEnv(mirrorUrl);
        for (const [key, value] of Object.entries(env)) {
          Deno.env.set(key, value);
        }
      } else if (context?.tool === "uv" || context?.tool === "pixi") {
        const env = getUvMirrorEnv(mirrorUrl);
        for (const [key, value] of Object.entries(env)) {
          Deno.env.set(key, value);
        }
      }
      // Generic mirror URL for other tools
      Deno.env.set("MIRROR_URL", mirrorUrl);
      break;
    }

    case "retry_with_timeout":
      // Store timeout for the caller to use
      Deno.env.set("RETRY_TIMEOUT_MS", String(fix.action.timeoutMs));
      break;

    case "custom":
      // Custom commands are logged but not executed automatically
      console.warn(`[diagnostics] 建议手动执行: ${fix.action.command}`);
      break;
  }
}

/**
 * Update retry context after an attempt
 */
export function updateRetryContext(
  context: RetryContext,
  fix: Fix,
  durationMs: number,
  diagnosis?: ErrorDiagnosis
): RetryContext {
  return {
    attempt: context.attempt + 1,
    lastDiagnosis: diagnosis ?? context.lastDiagnosis,
    appliedFixes: [...context.appliedFixes, fix.id],
    totalDurationMs: context.totalDurationMs + durationMs,
  };
}

/**
 * Generate a human-readable retry summary
 */
export function getRetrySummary(context: RetryContext): string {
  if (context.appliedFixes.length === 0) {
    return "未进行重试";
  }

  return `已尝试 ${context.attempt} 次，应用的修复: ${context.appliedFixes.join(", ")}`;
}

// ============ withRetry Higher-Order Function ============

/**
 * Result of a command execution
 */
export interface ExecutionResult {
  /** Exit code (0 = success) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
}

/**
 * Options for withRetry
 */
export interface WithRetryOptions {
  /** Diagnostic context for error classification */
  context?: DiagnosticContext;
  /** Retry configuration */
  config?: RetryConfig;
  /** Custom function to determine if execution failed */
  isFailed?: (result: ExecutionResult) => boolean;
  /** Callback before each retry (for logging/UI) */
  onRetry?: (fix: Fix, attempt: number, delayMs: number) => void | Promise<void>;
  /** Callback when retry is exhausted */
  onExhausted?: (context: RetryContext, lastDiagnosis: ErrorDiagnosis) => void | Promise<void>;
}

/**
 * Result of withRetry execution
 */
export interface WithRetryResult {
  /** Final execution result */
  result: ExecutionResult;
  /** Retry context with attempt history */
  retryContext: RetryContext;
  /** Whether the final result is a success */
  success: boolean;
}

/**
 * Higher-order function that wraps command execution with automatic retry.
 *
 * @example
 * ```typescript
 * const { result, success } = await withRetry(
 *   async () => {
 *     const cmd = new Deno.Command("pip", { args: ["install", "torch"] });
 *     const output = await cmd.output();
 *     return {
 *       exitCode: output.code,
 *       stdout: new TextDecoder().decode(output.stdout),
 *       stderr: new TextDecoder().decode(output.stderr),
 *     };
 *   },
 *   {
 *     context: { tool: "pip" },
 *     onRetry: (fix, attempt) => console.log(`Retry ${attempt}: ${fix.description}`),
 *   }
 * );
 * ```
 */
export async function withRetry(
  execute: () => Promise<ExecutionResult>,
  options: WithRetryOptions = {}
): Promise<WithRetryResult> {
  const {
    context,
    config = DEFAULT_CONFIG,
    isFailed = (r) => r.exitCode !== 0,
    onRetry,
    onExhausted,
  } = options;

  let retryContext = createRetryContext();

  while (true) {
    const startTime = Date.now();
    const result = await execute();
    const durationMs = Date.now() - startTime;

    // Success - return immediately
    if (!isFailed(result)) {
      return { result, retryContext, success: true };
    }

    // Diagnose the error
    const diagnosis = await classifyError(result.stderr, context);

    // Check if we should retry
    const { shouldRetry: retry, nextFix, delayMs } = shouldRetry(
      retryContext,
      diagnosis,
      config
    );

    if (!retry || !nextFix) {
      // No more retries available
      if (onExhausted) {
        await onExhausted(retryContext, diagnosis);
      }
      return {
        result,
        retryContext: { ...retryContext, lastDiagnosis: diagnosis },
        success: false,
      };
    }

    // Apply the fix
    applyFix(nextFix, context);
    retryContext = updateRetryContext(retryContext, nextFix, durationMs, diagnosis);

    // Notify callback
    if (onRetry) {
      await onRetry(nextFix, retryContext.attempt, delayMs);
    }

    // Wait before retry
    if (delayMs > 0) {
      await delay(delayMs);
    }
  }
}

/**
 * Async delay utility
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ Streaming Version ============

/**
 * Progress event emitted during retry
 */
export interface RetryProgressEvent {
  type: "retry_start" | "retry_delay" | "retry_exhausted";
  attempt?: number;
  fix?: Fix;
  delayMs?: number;
  diagnosis?: ErrorDiagnosis;
  context?: RetryContext;
}

/**
 * Streaming version of withRetry that yields progress events.
 * Useful for real-time UI updates.
 *
 * @example
 * ```typescript
 * for await (const event of withRetryStreaming(execute, options)) {
 *   if (event.type === "retry_start") {
 *     console.log(`Attempting fix: ${event.fix?.description}`);
 *   }
 * }
 * ```
 */
export async function* withRetryStreaming(
  execute: () => Promise<ExecutionResult>,
  options: Omit<WithRetryOptions, "onRetry" | "onExhausted"> = {}
): AsyncGenerator<RetryProgressEvent, WithRetryResult> {
  const {
    context,
    config = DEFAULT_CONFIG,
    isFailed = (r) => r.exitCode !== 0,
  } = options;

  let retryContext = createRetryContext();

  while (true) {
    const startTime = Date.now();
    const result = await execute();
    const durationMs = Date.now() - startTime;

    if (!isFailed(result)) {
      return { result, retryContext, success: true };
    }

    const diagnosis = await classifyError(result.stderr, context);
    const { shouldRetry: retry, nextFix, delayMs } = shouldRetry(
      retryContext,
      diagnosis,
      config
    );

    if (!retry || !nextFix) {
      yield {
        type: "retry_exhausted",
        diagnosis,
        context: retryContext,
      };
      return {
        result,
        retryContext: { ...retryContext, lastDiagnosis: diagnosis },
        success: false,
      };
    }

    applyFix(nextFix, context);
    retryContext = updateRetryContext(retryContext, nextFix, durationMs, diagnosis);

    yield {
      type: "retry_start",
      attempt: retryContext.attempt,
      fix: nextFix,
      delayMs,
    };

    if (delayMs > 0) {
      yield {
        type: "retry_delay",
        delayMs,
      };
      await delay(delayMs);
    }
  }
}
