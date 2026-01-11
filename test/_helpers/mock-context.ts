/**
 * Mock ToolContext factory for testing
 */

import type { ToolContext } from "../../src/types/tool.ts";

export interface MockContextOptions {
  cwd?: string;
  abortController?: AbortController;
  readFileTimestamps?: Record<string, number>;
}

/**
 * Create a mock ToolContext for testing tools
 */
export function createMockToolContext(
  options: MockContextOptions = {},
): ToolContext {
  return {
    abortController: options.abortController ?? new AbortController(),
    readFileTimestamps: options.readFileTimestamps ?? {},
    cwd: options.cwd ?? Deno.cwd(),
  };
}

/**
 * Create a pre-aborted context for testing abort handling
 */
export function createAbortedContext(
  options: MockContextOptions = {},
): ToolContext {
  const controller = new AbortController();
  controller.abort();
  return createMockToolContext({
    ...options,
    abortController: controller,
  });
}
