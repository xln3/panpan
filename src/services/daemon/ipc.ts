/**
 * IPC message encoding and decoding.
 *
 * Uses a length-prefixed JSON protocol:
 * - 4 bytes: message length (big-endian uint32)
 * - N bytes: JSON payload
 */

import type { IPCRequest, IPCResponse } from "./types.ts";

/** Maximum message size (16 MB) */
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

/** Interface for objects that can be read from (like Deno.Conn) */
interface Readable {
  read(p: Uint8Array): Promise<number | null>;
}

/** Interface for objects that can be written to (like Deno.Conn) */
interface Writable {
  write(p: Uint8Array): Promise<number>;
}

/** Error thrown when reading from a closed connection */
export class ConnectionClosedError extends Error {
  constructor() {
    super("Connection closed");
    this.name = "ConnectionClosedError";
  }
}

/** Error thrown when message is too large */
export class MessageTooLargeError extends Error {
  constructor(size: number) {
    super(`Message too large: ${size} bytes (max: ${MAX_MESSAGE_SIZE})`);
    this.name = "MessageTooLargeError";
  }
}

/**
 * Encode a message to bytes with length prefix.
 */
export function encodeMessage(message: IPCRequest | IPCResponse): Uint8Array {
  const json = JSON.stringify(message);
  const payload = new TextEncoder().encode(json);

  if (payload.length > MAX_MESSAGE_SIZE) {
    throw new MessageTooLargeError(payload.length);
  }

  // Create buffer: 4 bytes length + payload
  const buffer = new Uint8Array(4 + payload.length);
  const view = new DataView(buffer.buffer);

  // Write length as big-endian uint32
  view.setUint32(0, payload.length, false);

  // Copy payload
  buffer.set(payload, 4);

  return buffer;
}

/**
 * Decode a message from bytes (without length prefix).
 * Used after reading the exact payload bytes.
 */
export function decodeMessage<T extends IPCRequest | IPCResponse>(
  bytes: Uint8Array,
): T {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

/**
 * Read exactly n bytes from a reader.
 * Returns null if connection is closed before reading all bytes.
 */
async function readExact(
  reader: Readable,
  n: number,
): Promise<Uint8Array | null> {
  const buffer = new Uint8Array(n);
  let offset = 0;

  while (offset < n) {
    const bytesRead = await reader.read(buffer.subarray(offset));
    if (bytesRead === null) {
      // Connection closed
      if (offset === 0) return null; // Clean close
      throw new ConnectionClosedError(); // Partial read
    }
    offset += bytesRead;
  }

  return buffer;
}

/**
 * Read a complete message from a reader.
 * Returns null if connection is cleanly closed.
 */
export async function readMessage<T extends IPCRequest | IPCResponse>(
  reader: Readable,
): Promise<T | null> {
  // Read 4-byte length header
  const header = await readExact(reader, 4);
  if (header === null) return null;

  const view = new DataView(header.buffer);
  const length = view.getUint32(0, false);

  if (length > MAX_MESSAGE_SIZE) {
    throw new MessageTooLargeError(length);
  }

  if (length === 0) {
    throw new Error("Empty message");
  }

  // Read payload
  const payload = await readExact(reader, length);
  if (payload === null) {
    throw new ConnectionClosedError();
  }

  return decodeMessage<T>(payload);
}

/**
 * Write a complete message to a writer.
 */
export async function writeMessage(
  writer: Writable,
  message: IPCRequest | IPCResponse,
): Promise<void> {
  const encoded = encodeMessage(message);

  let offset = 0;
  while (offset < encoded.length) {
    const written = await writer.write(encoded.subarray(offset));
    offset += written;
  }
}

/**
 * Create a request message.
 */
export function createRequest(
  type: IPCRequest["type"],
  payload?: unknown,
): IPCRequest {
  return {
    id: crypto.randomUUID(),
    type,
    payload,
  };
}

/**
 * Create a success response.
 */
export function createSuccessResponse(id: string, data?: unknown): IPCResponse {
  return {
    id,
    success: true,
    data,
  };
}

/**
 * Create an error response.
 */
export function createErrorResponse(id: string, error: string): IPCResponse {
  return {
    id,
    success: false,
    error,
  };
}
