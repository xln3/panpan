/**
 * Output buffer for task execution.
 *
 * Stores output chunks in memory, supports:
 * - Appending new chunks
 * - Retrieving chunks from a given offset (for replay)
 * - Subscribing to new chunks (for live streaming)
 */

import type { OutputChunk, OutputChunkType } from "./types.ts";

/** Callback for new output chunks */
export type OutputSubscriber = (chunk: OutputChunk) => void;

/**
 * Buffer for storing and streaming task output.
 */
export class OutputBuffer {
  private chunks: OutputChunk[] = [];
  private subscribers = new Set<OutputSubscriber>();
  private nextId = 0;

  /** Append a new chunk to the buffer */
  append(type: OutputChunkType, content: string, metadata?: Record<string, unknown>): OutputChunk {
    const chunk: OutputChunk = {
      id: this.nextId++,
      timestamp: Date.now(),
      type,
      content,
      metadata,
    };

    this.chunks.push(chunk);

    // Notify all subscribers
    for (const subscriber of this.subscribers) {
      try {
        subscriber(chunk);
      } catch {
        // Ignore subscriber errors
      }
    }

    return chunk;
  }

  /** Get all chunks from a given offset */
  getChunks(fromId = 0): OutputChunk[] {
    if (fromId <= 0) {
      return [...this.chunks];
    }
    // Binary search would be overkill for typical sizes
    const startIndex = this.chunks.findIndex((c) => c.id >= fromId);
    if (startIndex === -1) {
      return [];
    }
    return this.chunks.slice(startIndex);
  }

  /** Get the latest chunk ID (for pagination) */
  getLatestId(): number {
    return this.nextId - 1;
  }

  /** Get total chunk count */
  getCount(): number {
    return this.chunks.length;
  }

  /** Subscribe to new chunks */
  subscribe(callback: OutputSubscriber): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Clear all subscribers */
  clearSubscribers(): void {
    this.subscribers.clear();
  }

  /** Clear all data */
  clear(): void {
    this.chunks = [];
    this.subscribers.clear();
    this.nextId = 0;
  }
}

/**
 * Manages output buffers for multiple tasks.
 */
export class OutputBufferManager {
  private buffers = new Map<string, OutputBuffer>();

  /** Get or create a buffer for a task */
  getBuffer(taskId: string): OutputBuffer {
    let buffer = this.buffers.get(taskId);
    if (!buffer) {
      buffer = new OutputBuffer();
      this.buffers.set(taskId, buffer);
    }
    return buffer;
  }

  /** Check if a buffer exists */
  hasBuffer(taskId: string): boolean {
    return this.buffers.has(taskId);
  }

  /** Remove a buffer (e.g., after task completion + grace period) */
  removeBuffer(taskId: string): void {
    const buffer = this.buffers.get(taskId);
    if (buffer) {
      buffer.clear();
      this.buffers.delete(taskId);
    }
  }

  /** Get all active task IDs */
  getTaskIds(): string[] {
    return [...this.buffers.keys()];
  }

  /** Clear all buffers */
  clear(): void {
    for (const buffer of this.buffers.values()) {
      buffer.clear();
    }
    this.buffers.clear();
  }
}
