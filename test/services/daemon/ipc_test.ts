/**
 * Tests for IPC message encoding/decoding.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  createErrorResponse,
  createRequest,
  createSuccessResponse,
  decodeMessage,
  encodeMessage,
  MessageTooLargeError,
  readMessage,
  writeMessage,
} from "../../../src/services/daemon/ipc.ts";
import type { IPCRequest, IPCResponse } from "../../../src/services/daemon/types.ts";

Deno.test("IPC - encodes and decodes request", () => {
  const request: IPCRequest = {
    id: "test-123",
    type: "ping",
  };

  const encoded = encodeMessage(request);

  // First 4 bytes are length
  const view = new DataView(encoded.buffer);
  const length = view.getUint32(0, false);
  assertEquals(length, encoded.length - 4);

  // Decode payload
  const payload = encoded.slice(4);
  const decoded = decodeMessage<IPCRequest>(payload);
  assertEquals(decoded.id, "test-123");
  assertEquals(decoded.type, "ping");
});

Deno.test("IPC - encodes and decodes response", () => {
  const response: IPCResponse = {
    id: "test-123",
    success: true,
    data: { pong: true },
  };

  const encoded = encodeMessage(response);
  const payload = encoded.slice(4);
  const decoded = decodeMessage<IPCResponse>(payload);

  assertEquals(decoded.id, "test-123");
  assertEquals(decoded.success, true);
  assertEquals(decoded.data, { pong: true });
});

Deno.test("IPC - encodes request with payload", () => {
  const request: IPCRequest = {
    id: "test-456",
    type: "session_create",
    payload: {
      projectRoot: "/test/project",
      model: "claude-haiku",
    },
  };

  const encoded = encodeMessage(request);
  const payload = encoded.slice(4);
  const decoded = decodeMessage<IPCRequest>(payload);

  assertEquals(decoded.type, "session_create");
  assertEquals((decoded.payload as { projectRoot: string }).projectRoot, "/test/project");
});

Deno.test("IPC - createRequest generates UUID", () => {
  const request = createRequest("ping");
  assertEquals(request.type, "ping");
  assertEquals(typeof request.id, "string");
  assertEquals(request.id.length, 36); // UUID length
});

Deno.test("IPC - createSuccessResponse", () => {
  const response = createSuccessResponse("req-123", { value: 42 });
  assertEquals(response.id, "req-123");
  assertEquals(response.success, true);
  assertEquals(response.data, { value: 42 });
  assertEquals(response.error, undefined);
});

Deno.test("IPC - createErrorResponse", () => {
  const response = createErrorResponse("req-123", "Something went wrong");
  assertEquals(response.id, "req-123");
  assertEquals(response.success, false);
  assertEquals(response.error, "Something went wrong");
  assertEquals(response.data, undefined);
});

Deno.test("IPC - handles empty payload", () => {
  const request: IPCRequest = {
    id: "test-789",
    type: "ping",
    payload: undefined,
  };

  const encoded = encodeMessage(request);
  const payload = encoded.slice(4);
  const decoded = decodeMessage<IPCRequest>(payload);

  assertEquals(decoded.payload, undefined);
});

Deno.test("IPC - handles complex payload", () => {
  const request: IPCRequest = {
    id: "test-complex",
    type: "session_create",
    payload: {
      projectRoot: "/test",
      model: "haiku",
      metadata: {
        nested: { array: [1, 2, 3] },
        unicode: "日本語",
        special: "line\nbreak\ttab",
      },
    },
  };

  const encoded = encodeMessage(request);
  const payload = encoded.slice(4);
  const decoded = decodeMessage<IPCRequest>(payload);

  const meta = (decoded.payload as { metadata: unknown }).metadata as Record<string, unknown>;
  assertEquals((meta.nested as { array: number[] }).array, [1, 2, 3]);
  assertEquals(meta.unicode, "日本語");
  assertEquals(meta.special, "line\nbreak\ttab");
});

Deno.test("IPC - encodes and decodes full message", () => {
  // Test the full encode/decode cycle without streams
  const request: IPCRequest = {
    id: "pipe-test",
    type: "session_get",
    payload: { id: "session-123" },
  };

  const encoded = encodeMessage(request);

  // Verify format: 4 byte length header + payload
  const view = new DataView(encoded.buffer);
  const length = view.getUint32(0, false);
  assertEquals(length, encoded.length - 4);

  // Decode the payload portion
  const payload = encoded.slice(4);
  const decoded = decodeMessage<IPCRequest>(payload);

  assertEquals(decoded.id, "pipe-test");
  assertEquals(decoded.type, "session_get");
  assertEquals((decoded.payload as { id: string }).id, "session-123");
});

Deno.test("IPC - rejects oversized messages on encode", () => {
  // Create a message that's too large (> 16 MB)
  const largePayload = "x".repeat(17 * 1024 * 1024);
  const request: IPCRequest = {
    id: "large",
    type: "ping",
    payload: largePayload,
  };

  assertThrows(
    () => encodeMessage(request),
    MessageTooLargeError,
  );
});
