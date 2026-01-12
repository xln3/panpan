/**
 * Tests for src/utils/todo-storage.ts
 *
 * Note: Many tests use sanitizeOps: false because setTodos() uses fire-and-forget
 * async saveToDisk(), which completes after the test ends.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  clearTodos,
  getActiveTodo,
  getTodos,
  getTodosJSON,
  getTodoStats,
  initTodos,
  renderTodos,
  setTodos,
  setTodosAsync,
} from "../../src/utils/todo-storage.ts";
import type { TodoInput } from "../../src/types/todo.ts";

// =============================================================================
// Helper to reset todo state between tests
// =============================================================================

async function resetTodos(): Promise<void> {
  await clearTodos();
}

// Small delay to let fire-and-forget operations complete
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// =============================================================================
// setTodos validation tests
// =============================================================================

Deno.test({
  name: "setTodos - validates only one in_progress",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    const todos: TodoInput[] = [
      {
        content: "Task 1",
        status: "in_progress",
        activeForm: "Working on Task 1",
      },
      {
        content: "Task 2",
        status: "in_progress",
        activeForm: "Working on Task 2",
      },
    ];

    const result = setTodos(todos);

    assertEquals(result.success, false);
    assertEquals(
      result.error?.includes("Only one task can be in_progress"),
      true,
    );
  },
});

Deno.test({
  name: "setTodos - allows zero in_progress",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    const todos: TodoInput[] = [
      { content: "Task 1", status: "pending", activeForm: "Working on Task 1" },
      {
        content: "Task 2",
        status: "completed",
        activeForm: "Working on Task 2",
      },
    ];

    const result = setTodos(todos);

    assertEquals(result.success, true);
    assertEquals(result.error, undefined);
    await delay(50);
  },
});

Deno.test({
  name: "setTodos - allows exactly one in_progress",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    const todos: TodoInput[] = [
      { content: "Task 1", status: "pending", activeForm: "Working on Task 1" },
      {
        content: "Task 2",
        status: "in_progress",
        activeForm: "Working on Task 2",
      },
      {
        content: "Task 3",
        status: "completed",
        activeForm: "Working on Task 3",
      },
    ];

    const result = setTodos(todos);

    assertEquals(result.success, true);
    await delay(50);
  },
});

// =============================================================================
// setTodos ID management tests
// =============================================================================

Deno.test({
  name: "setTodos - generates new ID for new todos",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      {
        content: "New Task",
        status: "pending",
        activeForm: "Working on New Task",
      },
    ]);

    const todos = getTodos();
    assertEquals(todos.length, 1);
    assertNotEquals(todos[0].id, "");
    assertNotEquals(todos[0].id, undefined);
    await delay(50);
  },
});

Deno.test({
  name: "setTodos - preserves existing todo IDs",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    // Create initial todo
    setTodos([
      { content: "Task 1", status: "pending", activeForm: "Working on Task 1" },
    ]);
    const initialId = getTodos()[0].id;
    await delay(50);

    // Update same todo
    setTodos([
      {
        content: "Task 1",
        status: "in_progress",
        activeForm: "Working on Task 1",
      },
    ]);

    const todos = getTodos();
    assertEquals(todos[0].id, initialId);
    await delay(50);
  },
});

Deno.test({
  name: "setTodos - matches by content",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Same Content", status: "pending", activeForm: "Form A" },
    ]);
    const initialId = getTodos()[0].id;
    await delay(50);

    // Update with same content but different activeForm
    setTodos([
      { content: "Same Content", status: "completed", activeForm: "Form B" },
    ]);

    assertEquals(getTodos()[0].id, initialId);
    await delay(50);
  },
});

Deno.test({
  name: "setTodos - matches by activeForm",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Content A", status: "pending", activeForm: "Same Form" },
    ]);
    const initialId = getTodos()[0].id;
    await delay(50);

    // Update with same activeForm but different content
    setTodos([
      { content: "Content B", status: "completed", activeForm: "Same Form" },
    ]);

    assertEquals(getTodos()[0].id, initialId);
    await delay(50);
  },
});

// =============================================================================
// setTodos timestamp tests
// =============================================================================

Deno.test({
  name: "setTodos - sets createdAt and updatedAt for new todos",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();
    const before = Date.now();

    setTodos([
      { content: "New Task", status: "pending", activeForm: "Working" },
    ]);

    const after = Date.now();
    const todo = getTodos()[0];

    assertEquals(todo.createdAt >= before, true);
    assertEquals(todo.createdAt <= after, true);
    assertEquals(todo.updatedAt >= before, true);
    assertEquals(todo.updatedAt <= after, true);
    await delay(50);
  },
});

Deno.test({
  name: "setTodos - preserves createdAt on update",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Task", status: "pending", activeForm: "Working" },
    ]);
    const originalCreatedAt = getTodos()[0].createdAt;
    await delay(50);

    // Wait a bit to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));

    setTodos([
      { content: "Task", status: "completed", activeForm: "Working" },
    ]);

    assertEquals(getTodos()[0].createdAt, originalCreatedAt);
    await delay(50);
  },
});

Deno.test({
  name: "setTodos - updates updatedAt on update",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Task", status: "pending", activeForm: "Working" },
    ]);
    const originalUpdatedAt = getTodos()[0].updatedAt;
    await delay(50);

    // Wait a bit to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));

    setTodos([
      { content: "Task", status: "completed", activeForm: "Working" },
    ]);

    const newUpdatedAt = getTodos()[0].updatedAt;
    assertEquals(newUpdatedAt > originalUpdatedAt, true);
    await delay(50);
  },
});

// =============================================================================
// getTodos tests
// =============================================================================

Deno.test("getTodos - returns empty array initially", async () => {
  await resetTodos();
  assertEquals(getTodos(), []);
});

Deno.test({
  name: "getTodos - returns copy of todos array",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Task", status: "pending", activeForm: "Working" },
    ]);

    const todos1 = getTodos();
    const todos2 = getTodos();

    // Should be equal in content
    assertEquals(todos1, todos2);
    // But different arrays (copy)
    assertNotEquals(todos1 === todos2, true);
    await delay(50);
  },
});

// =============================================================================
// clearTodos tests
// =============================================================================

Deno.test({
  name: "clearTodos - removes all todos",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    setTodos([
      { content: "Task 1", status: "pending", activeForm: "Working 1" },
      { content: "Task 2", status: "completed", activeForm: "Working 2" },
    ]);
    await delay(50);

    await clearTodos();

    assertEquals(getTodos().length, 0);
  },
});

// =============================================================================
// getActiveTodo tests
// =============================================================================

Deno.test({
  name: "getActiveTodo - returns undefined when no in_progress",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Task 1", status: "pending", activeForm: "Working 1" },
      { content: "Task 2", status: "completed", activeForm: "Working 2" },
    ]);

    assertEquals(getActiveTodo(), undefined);
    await delay(50);
  },
});

Deno.test({
  name: "getActiveTodo - returns in_progress todo",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Task 1", status: "pending", activeForm: "Working 1" },
      { content: "Task 2", status: "in_progress", activeForm: "Working 2" },
      { content: "Task 3", status: "completed", activeForm: "Working 3" },
    ]);

    const active = getActiveTodo();
    assertEquals(active?.content, "Task 2");
    assertEquals(active?.status, "in_progress");
    await delay(50);
  },
});

// =============================================================================
// getTodoStats tests
// =============================================================================

Deno.test({
  name: "getTodoStats - counts by status",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Task 1", status: "pending", activeForm: "Working 1" },
      { content: "Task 2", status: "pending", activeForm: "Working 2" },
      { content: "Task 3", status: "in_progress", activeForm: "Working 3" },
      { content: "Task 4", status: "completed", activeForm: "Working 4" },
      { content: "Task 5", status: "completed", activeForm: "Working 5" },
      { content: "Task 6", status: "completed", activeForm: "Working 6" },
    ]);

    const stats = getTodoStats();

    assertEquals(stats.total, 6);
    assertEquals(stats.pending, 2);
    assertEquals(stats.inProgress, 1);
    assertEquals(stats.completed, 3);
    await delay(50);
  },
});

Deno.test("getTodoStats - returns zeros for empty list", async () => {
  await resetTodos();

  const stats = getTodoStats();

  assertEquals(stats.total, 0);
  assertEquals(stats.pending, 0);
  assertEquals(stats.inProgress, 0);
  assertEquals(stats.completed, 0);
});

// =============================================================================
// renderTodos tests
// =============================================================================

Deno.test("renderTodos - shows empty message when no todos", async () => {
  await resetTodos();

  const output = renderTodos();
  assertEquals(output, "No todos currently tracked");
});

Deno.test({
  name: "renderTodos - renders pending as ○",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Pending task", status: "pending", activeForm: "Working" },
    ]);

    const output = renderTodos();
    assertEquals(output.includes("○"), true);
    assertEquals(output.includes("Pending task"), true);
    await delay(50);
  },
});

Deno.test({
  name: "renderTodos - renders in_progress as ◉ with activeForm",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      {
        content: "Active task",
        status: "in_progress",
        activeForm: "Actively working",
      },
    ]);

    const output = renderTodos();
    assertEquals(output.includes("◉"), true);
    assertEquals(output.includes("Actively working"), true);
    await delay(50);
  },
});

Deno.test({
  name: "renderTodos - renders completed as ✓",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Done task", status: "completed", activeForm: "Working" },
    ]);

    const output = renderTodos();
    assertEquals(output.includes("✓"), true);
    assertEquals(output.includes("Done task"), true);
    await delay(50);
  },
});

// =============================================================================
// getTodosJSON tests
// =============================================================================

Deno.test({
  name: "getTodosJSON - returns JSON string",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    setTodos([
      { content: "Task 1", status: "pending", activeForm: "Working 1" },
    ]);

    const json = getTodosJSON();
    const parsed = JSON.parse(json);

    assertEquals(Array.isArray(parsed), true);
    assertEquals(parsed[0].content, "Task 1");
    assertEquals(parsed[0].status, "pending");
    await delay(50);
  },
});

Deno.test({
  name: "getTodosJSON - truncates long content",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    const longContent = "A".repeat(150);
    setTodos([
      { content: longContent, status: "pending", activeForm: "Short" },
    ]);

    const json = getTodosJSON();
    const parsed = JSON.parse(json);

    assertEquals(parsed[0].content.length, 100);
    assertEquals(parsed[0].content.endsWith("..."), true);
    await delay(50);
  },
});

Deno.test({
  name: "getTodosJSON - truncates long activeForm",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await resetTodos();

    const longForm = "B".repeat(150);
    setTodos([
      { content: "Short", status: "pending", activeForm: longForm },
    ]);

    const json = getTodosJSON();
    const parsed = JSON.parse(json);

    assertEquals(parsed[0].activeForm.length, 100);
    assertEquals(parsed[0].activeForm.endsWith("..."), true);
    await delay(50);
  },
});

// =============================================================================
// setTodosAsync tests
// =============================================================================

Deno.test("setTodosAsync - validates like sync version", async () => {
  await resetTodos();

  const result = await setTodosAsync([
    { content: "Task 1", status: "in_progress", activeForm: "Working 1" },
    { content: "Task 2", status: "in_progress", activeForm: "Working 2" },
  ]);

  assertEquals(result.success, false);
  assertEquals(result.error?.includes("Only one task"), true);
});

Deno.test("setTodosAsync - persists todos", async () => {
  await resetTodos();

  await setTodosAsync([
    { content: "Async Task", status: "pending", activeForm: "Working async" },
  ]);

  const todos = getTodos();
  assertEquals(todos.length, 1);
  assertEquals(todos[0].content, "Async Task");
});

// =============================================================================
// initTodos tests
// =============================================================================

Deno.test("initTodos - loads todos from disk", async () => {
  await resetTodos();

  // Set some todos
  await setTodosAsync([
    { content: "Persisted Task", status: "pending", activeForm: "Working" },
  ]);

  // Re-init should load them
  await initTodos();

  const todos = getTodos();
  assertEquals(todos.length, 1);
  assertEquals(todos[0].content, "Persisted Task");
});
