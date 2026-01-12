/**
 * Diagnostics module for automatic error detection, classification, and retry.
 *
 * Main exports:
 * - `withRetry` - Higher-order function for automatic retry with diagnosis
 * - `withRetryStreaming` - Streaming version that yields progress events
 * - `classifyError` - Classify stderr and suggest fixes
 * - `diagnoseNetwork` - Network connectivity diagnostics
 *
 * @example
 * ```typescript
 * import { withRetry } from "./utils/diagnostics/mod.ts";
 *
 * const { result, success } = await withRetry(
 *   async () => runPipInstall("torch"),
 *   { context: { tool: "pip" } }
 * );
 * ```
 */

// Network diagnostics
export { detectProxyConfig, diagnoseNetwork } from "./network-diagnostics.ts";

// Configuration detection
export {
  getMirrors,
  getMirrorsForUrl,
  getPipMirrorEnv,
  getUvMirrorEnv,
} from "./config-detector.ts";

// Error classification
export {
  classifyError,
  type DiagnosticContext,
  type DiagnosticToolType,
} from "./error-classifier.ts";

// Retry policy and withRetry
export {
  applyFix,
  // Core functions
  createRetryContext,
  type ExecutionResult,
  getRetrySummary,
  // Types
  type RetryConfig,
  type RetryContext,
  type RetryProgressEvent,
  shouldRetry,
  updateRetryContext,
  // Higher-order functions
  withRetry,
  type WithRetryOptions,
  type WithRetryResult,
  withRetryStreaming,
} from "./retry-policy.ts";
