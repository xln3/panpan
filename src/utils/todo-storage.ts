/**
 * Todo storage - persistent storage for task tracking
 * Stores todos in ~/.panpan/todos.json
 */

import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { TodoInput, TodoItem, TodoStorageData } from "../types/todo.ts";

// In-memory cache
let todos: TodoItem[] = [];
let lastLoadTime = 0;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get storage directory path
 */
function getStorageDir(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
  return join(home, ".panpan");
}

/**
 * Get storage file path
 */
function getStorageFile(): string {
  return join(getStorageDir(), "todos.json");
}

/**
 * Load todos from disk
 */
async function loadFromDisk(): Promise<TodoItem[]> {
  try {
    const content = await Deno.readTextFile(getStorageFile());
    const data: TodoStorageData = JSON.parse(content);
    return data.todos || [];
  } catch {
    // File doesn't exist or is invalid
    return [];
  }
}

/**
 * Save todos to disk
 */
async function saveToDisk(items: TodoItem[]): Promise<void> {
  try {
    await ensureDir(getStorageDir());
    const data: TodoStorageData = {
      todos: items,
      lastUpdated: Date.now(),
    };
    await Deno.writeTextFile(getStorageFile(), JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Failed to save todos:", error);
  }
}

/**
 * Get all todos (with caching)
 */
export function getTodos(): TodoItem[] {
  // Return cached version (sync for compatibility)
  return [...todos];
}

/**
 * Get all todos (async, refreshes from disk if cache expired)
 */
export async function getTodosAsync(): Promise<TodoItem[]> {
  const now = Date.now();
  if (now - lastLoadTime > CACHE_TTL) {
    todos = await loadFromDisk();
    lastLoadTime = now;
  }
  return [...todos];
}

/**
 * Set todos with validation and persistence
 */
export async function setTodosAsync(
  newTodos: TodoInput[],
): Promise<{ success: boolean; error?: string }> {
  // Validate: only one in_progress at a time
  const inProgress = newTodos.filter((t) => t.status === "in_progress");
  if (inProgress.length > 1) {
    return {
      success: false,
      error:
        `Only one task can be in_progress at a time. Found ${inProgress.length}: ${
          inProgress
            .map((t) => t.content)
            .join(", ")
        }`,
    };
  }

  const now = Date.now();

  // Convert inputs to TodoItems, reusing existing IDs and preserving metadata
  const updatedTodos: TodoItem[] = newTodos.map((input) => {
    // Try to find existing todo with same content
    const existing = todos.find(
      (t) => t.content === input.content || t.activeForm === input.activeForm,
    );

    if (existing) {
      // Preserve ID and createdAt, update the rest
      return {
        id: existing.id,
        content: input.content,
        status: input.status,
        activeForm: input.activeForm,
        createdAt: existing.createdAt,
        updatedAt: now,
        priority: existing.priority,
      };
    }

    // New todo
    return {
      id: crypto.randomUUID(),
      content: input.content,
      status: input.status,
      activeForm: input.activeForm,
      createdAt: now,
      updatedAt: now,
    };
  });

  todos = updatedTodos;
  lastLoadTime = now;

  // Persist to disk
  await saveToDisk(todos);

  return { success: true };
}

/**
 * Set todos (sync version for backward compatibility)
 */
export function setTodos(
  newTodos: TodoInput[],
): { success: boolean; error?: string } {
  // Validate: only one in_progress at a time
  const inProgress = newTodos.filter((t) => t.status === "in_progress");
  if (inProgress.length > 1) {
    return {
      success: false,
      error:
        `Only one task can be in_progress at a time. Found ${inProgress.length}: ${
          inProgress
            .map((t) => t.content)
            .join(", ")
        }`,
    };
  }

  const now = Date.now();

  // Convert inputs to TodoItems, reusing existing IDs and preserving metadata
  const updatedTodos: TodoItem[] = newTodos.map((input) => {
    // Try to find existing todo with same content
    const existing = todos.find(
      (t) => t.content === input.content || t.activeForm === input.activeForm,
    );

    if (existing) {
      return {
        id: existing.id,
        content: input.content,
        status: input.status,
        activeForm: input.activeForm,
        createdAt: existing.createdAt,
        updatedAt: now,
        priority: existing.priority,
      };
    }

    return {
      id: crypto.randomUUID(),
      content: input.content,
      status: input.status,
      activeForm: input.activeForm,
      createdAt: now,
      updatedAt: now,
    };
  });

  todos = updatedTodos;
  lastLoadTime = now;

  // Fire-and-forget save
  saveToDisk(todos).catch(() => {});

  return { success: true };
}

/**
 * Clear all todos
 */
export async function clearTodos(): Promise<void> {
  todos = [];
  lastLoadTime = Date.now();
  await saveToDisk([]);
}

/**
 * Get the currently active (in_progress) todo
 */
export function getActiveTodo(): TodoItem | undefined {
  return todos.find((t) => t.status === "in_progress");
}

/**
 * Get todo statistics
 */
export function getTodoStats(): {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
} {
  return {
    total: todos.length,
    pending: todos.filter((t) => t.status === "pending").length,
    inProgress: todos.filter((t) => t.status === "in_progress").length,
    completed: todos.filter((t) => t.status === "completed").length,
  };
}

/**
 * Initialize todos from disk (call at startup)
 */
export async function initTodos(): Promise<void> {
  todos = await loadFromDisk();
  lastLoadTime = Date.now();
}

/**
 * Render todos for display
 */
export function renderTodos(): string {
  if (todos.length === 0) {
    return "No todos currently tracked";
  }

  const lines: string[] = [];
  for (const todo of todos) {
    if (todo.status === "completed") {
      lines.push(colors.dim(`  ✓ ${todo.content}`));
    } else if (todo.status === "in_progress") {
      lines.push(colors.cyan(`→ ◉ ${todo.activeForm}`));
    } else {
      lines.push(`  ○ ${todo.content}`);
    }
  }
  return lines.join("\n");
}

/**
 * Get todos as JSON string (for reminders)
 */
export function getTodosJSON(): string {
  return JSON.stringify(
    todos.map((t) => ({
      content: t.content.length > 100
        ? t.content.slice(0, 97) + "..."
        : t.content,
      status: t.status,
      activeForm: t.activeForm.length > 100
        ? t.activeForm.slice(0, 97) + "..."
        : t.activeForm,
    })),
  );
}
