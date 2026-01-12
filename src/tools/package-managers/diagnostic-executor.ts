/**
 * Diagnostic executor for package manager commands.
 * Wraps command execution with automatic error diagnosis, retry, and mirror switching.
 */

import {
  applyFix,
  classifyError,
  createRetryContext,
  shouldRetry,
  updateRetryContext,
} from "../../utils/diagnostics/mod.ts";
import {
  type CommandResult,
  executeCommandStreaming,
  type StreamingLine,
} from "./common.ts";
import { getMirrorConfig, type PackageManagerTool } from "./mirror-configs.ts";

/**
 * Configuration for diagnostic executor
 */
export interface DiagnosticExecutorConfig {
  /** Package manager tool type */
  tool: PackageManagerTool;
  /** Maximum retry attempts */
  maxAttempts?: number;
}

/**
 * Progress event during diagnostic execution
 */
export interface DiagnosticProgress {
  type: "progress";
  message: string;
}

/**
 * Extended result with diagnostic information
 */
export interface DiagnosticResult extends CommandResult {
  /** Number of attempts made */
  attempts: number;
  /** List of fix IDs that were applied */
  appliedFixes: string[];
  /** Diagnosis information if failed */
  diagnosis?: {
    type: string;
    autoFixable: boolean;
    userQuestion?: string;
  };
}

/**
 * Execute a command with automatic diagnosis and retry.
 *
 * Core flow:
 * 1. Execute command with streaming output
 * 2. On failure, diagnose the error
 * 3. If auto-fixable, apply fix and retry
 * 4. Repeat until success or budget exhausted
 *
 * @example
 * ```typescript
 * for await (const item of executeWithDiagnostics(
 *   ["pip", "install", "torch"],
 *   cwd,
 *   timeout,
 *   abortController,
 *   { tool: "pip" }
 * )) {
 *   if ("stream" in item) {
 *     // Streaming output line
 *   } else if ("type" in item && item.type === "progress") {
 *     // Diagnostic progress message
 *   } else {
 *     // Final result
 *   }
 * }
 * ```
 */
export async function* executeWithDiagnostics(
  baseCommand: string[],
  cwd: string,
  timeout: number,
  abortController: AbortController,
  config: DiagnosticExecutorConfig,
): AsyncGenerator<StreamingLine | DiagnosticProgress | DiagnosticResult> {
  const maxAttempts = config.maxAttempts ?? 3;
  const mirrorConfig = getMirrorConfig(config.tool);

  let retryContext = createRetryContext();
  let currentCommand = [...baseCommand];
  let lastResult: CommandResult | undefined;

  while (retryContext.attempt < maxAttempts) {
    // ========== 1. Output retry info if retrying ==========
    if (retryContext.attempt > 0) {
      yield {
        type: "progress",
        message: `重试 #${retryContext.attempt}: ${currentCommand.join(" ")}`,
      };
    }

    // ========== 2. Execute current command ==========
    const startTime = Date.now();
    for await (
      const item of executeCommandStreaming(
        currentCommand,
        cwd,
        timeout,
        abortController,
      )
    ) {
      if ("stream" in item) {
        yield item; // Stream line through
      } else {
        lastResult = item; // Final result
      }
    }

    // ========== 3. Success - return immediately ==========
    if (lastResult && lastResult.exitCode === 0) {
      yield {
        ...lastResult,
        attempts: retryContext.attempt + 1,
        appliedFixes: retryContext.appliedFixes,
      };
      return;
    }

    // ========== 4. Failure - diagnose error ==========
    const diagnosis = await classifyError(lastResult?.stderr || "", {
      tool: config.tool,
    });

    // ========== 5. Check if retry is possible ==========
    const retryDecision = shouldRetry(retryContext, diagnosis);

    if (!retryDecision.shouldRetry || !retryDecision.nextFix) {
      // Cannot auto-fix - return failure with diagnosis
      yield {
        ...(lastResult || emptyResult()),
        attempts: retryContext.attempt + 1,
        appliedFixes: retryContext.appliedFixes,
        diagnosis: {
          type: diagnosis.type,
          autoFixable: diagnosis.autoFixable,
          userQuestion: diagnosis.userQuestion,
        },
      };
      return;
    }

    // ========== 6. Apply fix ==========
    const { nextFix, delayMs } = retryDecision;

    yield {
      type: "progress",
      message: `诊断: ${diagnosis.type}, 尝试修复: ${nextFix.description}`,
    };

    // Apply environment variable fixes
    applyFix(nextFix, { tool: config.tool });

    // If mirror fix, modify command arguments
    if (nextFix.action.type === "use_mirror") {
      currentCommand = [
        ...baseCommand,
        ...mirrorConfig.getMirrorArgs(nextFix.action.url),
      ];
    }

    // ========== 7. Update context and wait before retry ==========
    const durationMs = Date.now() - startTime;
    retryContext = updateRetryContext(
      retryContext,
      nextFix,
      durationMs,
      diagnosis,
    );

    if (delayMs > 0) {
      yield {
        type: "progress",
        message: `等待 ${(delayMs / 1000).toFixed(1)}s 后重试...`,
      };
      await delay(delayMs);
    }
  }

  // Max retries exhausted
  yield {
    ...(lastResult || emptyResult()),
    attempts: retryContext.attempt,
    appliedFixes: retryContext.appliedFixes,
    diagnosis: {
      type: "max_retries_exceeded",
      autoFixable: false,
      userQuestion: `已尝试 ${retryContext.attempt} 次，所有自动修复均失败`,
    },
  };
}

/**
 * Create an empty result for error cases
 */
function emptyResult(): CommandResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: -1,
    durationMs: 0,
    timedOut: false,
  };
}

/**
 * Async delay utility
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
