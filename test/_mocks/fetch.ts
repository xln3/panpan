/**
 * Mock fetch for testing HTTP requests
 */

type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/**
 * Mock global fetch
 * Returns a cleanup function to restore the original fetch
 */
export function mockFetch(
  responses: Map<string, Response> | FetchHandler,
): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    if (typeof responses === "function") {
      return responses(url, init);
    }

    const response = responses.get(url);
    if (!response) {
      throw new Error(`No mock response for ${url}`);
    }
    return response.clone();
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

/**
 * Create a JSON response
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

/**
 * Create an error response
 */
export function errorResponse(
  message: string,
  status = 500,
): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Create a SSE stream response
 */
export function sseResponse(
  events: Array<{ data: string }>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event.data}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}
