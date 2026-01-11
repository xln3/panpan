/**
 * SSE (Server-Sent Events) stream parser
 * Parses streaming responses from OpenAI-compatible APIs
 */

import type { StreamingChunk } from "../types/llm.ts";

/**
 * Parse SSE stream from response body
 * Yields parsed JSON chunks
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamingChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal.aborted) {
        await reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split by newlines and process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith(":")) {
          continue;
        }

        // Parse SSE data lines
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6).trim();

          // [DONE] signals end of stream
          if (data === "[DONE]") {
            return;
          }

          if (data) {
            try {
              const parsed = JSON.parse(data) as StreamingChunk;
              yield parsed;
            } catch {
              // Skip malformed JSON chunks
              console.warn("Failed to parse SSE chunk:", data);
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Accumulated tool call state during streaming
 */
export interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Accumulate streaming tool calls
 * OpenAI streams tool calls in fragments
 */
export function accumulateToolCalls(
  existing: Map<number, AccumulatedToolCall>,
  delta: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[],
): void {
  for (const tc of delta) {
    const current = existing.get(tc.index) ||
      { id: "", name: "", arguments: "" };

    if (tc.id) {
      current.id = tc.id;
    }
    if (tc.function?.name) {
      current.name = tc.function.name;
    }
    if (tc.function?.arguments) {
      current.arguments += tc.function.arguments;
    }

    existing.set(tc.index, current);
  }
}
