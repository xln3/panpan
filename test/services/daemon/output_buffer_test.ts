/**
 * Tests for OutputBuffer.
 */

import { assertEquals } from "@std/assert";
import {
  OutputBuffer,
  OutputBufferManager,
} from "../../../src/services/daemon/output-buffer.ts";

Deno.test("OutputBuffer - appends chunks", () => {
  const buffer = new OutputBuffer();

  const chunk1 = buffer.append("text", "Hello");
  const chunk2 = buffer.append("text", "World");

  assertEquals(chunk1.id, 0);
  assertEquals(chunk1.content, "Hello");
  assertEquals(chunk2.id, 1);
  assertEquals(chunk2.content, "World");
  assertEquals(buffer.getCount(), 2);
});

Deno.test("OutputBuffer - appends with metadata", () => {
  const buffer = new OutputBuffer();

  const chunk = buffer.append("tool_use", "bash", { command: "ls" });

  assertEquals(chunk.type, "tool_use");
  assertEquals(chunk.metadata, { command: "ls" });
});

Deno.test("OutputBuffer - getChunks returns all", () => {
  const buffer = new OutputBuffer();
  buffer.append("text", "A");
  buffer.append("text", "B");
  buffer.append("text", "C");

  const chunks = buffer.getChunks();
  assertEquals(chunks.length, 3);
  assertEquals(chunks.map((c) => c.content), ["A", "B", "C"]);
});

Deno.test("OutputBuffer - getChunks with fromId", () => {
  const buffer = new OutputBuffer();
  buffer.append("text", "A"); // id=0
  buffer.append("text", "B"); // id=1
  buffer.append("text", "C"); // id=2

  const chunks = buffer.getChunks(1);
  assertEquals(chunks.length, 2);
  assertEquals(chunks.map((c) => c.content), ["B", "C"]);
});

Deno.test("OutputBuffer - getChunks beyond end", () => {
  const buffer = new OutputBuffer();
  buffer.append("text", "A");

  const chunks = buffer.getChunks(10);
  assertEquals(chunks.length, 0);
});

Deno.test("OutputBuffer - subscribe receives new chunks", () => {
  const buffer = new OutputBuffer();
  const received: string[] = [];

  const unsubscribe = buffer.subscribe((chunk) => {
    received.push(chunk.content);
  });

  buffer.append("text", "A");
  buffer.append("text", "B");

  assertEquals(received, ["A", "B"]);

  unsubscribe();

  buffer.append("text", "C");
  assertEquals(received, ["A", "B"]); // C not received
});

Deno.test("OutputBuffer - multiple subscribers", () => {
  const buffer = new OutputBuffer();
  const received1: string[] = [];
  const received2: string[] = [];

  buffer.subscribe((c) => received1.push(c.content));
  buffer.subscribe((c) => received2.push(c.content));

  buffer.append("text", "X");

  assertEquals(received1, ["X"]);
  assertEquals(received2, ["X"]);
});

Deno.test("OutputBuffer - clear removes all", () => {
  const buffer = new OutputBuffer();
  buffer.append("text", "A");
  buffer.append("text", "B");

  buffer.clear();

  assertEquals(buffer.getCount(), 0);
  assertEquals(buffer.getChunks(), []);
});

Deno.test("OutputBufferManager - getBuffer creates new", () => {
  const manager = new OutputBufferManager();

  const buffer1 = manager.getBuffer("task1");
  const buffer2 = manager.getBuffer("task1");

  assertEquals(buffer1, buffer2); // Same buffer
});

Deno.test("OutputBufferManager - different tasks different buffers", () => {
  const manager = new OutputBufferManager();

  const buffer1 = manager.getBuffer("task1");
  const buffer2 = manager.getBuffer("task2");

  buffer1.append("text", "A");
  buffer2.append("text", "B");

  assertEquals(buffer1.getChunks()[0].content, "A");
  assertEquals(buffer2.getChunks()[0].content, "B");
});

Deno.test("OutputBufferManager - hasBuffer", () => {
  const manager = new OutputBufferManager();

  assertEquals(manager.hasBuffer("task1"), false);

  manager.getBuffer("task1");
  assertEquals(manager.hasBuffer("task1"), true);
});

Deno.test("OutputBufferManager - removeBuffer", () => {
  const manager = new OutputBufferManager();

  manager.getBuffer("task1").append("text", "data");
  manager.removeBuffer("task1");

  assertEquals(manager.hasBuffer("task1"), false);
});

Deno.test("OutputBufferManager - getTaskIds", () => {
  const manager = new OutputBufferManager();

  manager.getBuffer("task1");
  manager.getBuffer("task2");
  manager.getBuffer("task3");

  const ids = manager.getTaskIds();
  assertEquals(ids.sort(), ["task1", "task2", "task3"]);
});
