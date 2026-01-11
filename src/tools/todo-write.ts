/**
 * TodoWrite tool - manages task list for tracking progress
 */

import { z } from "zod";
import type { Tool } from "../types/tool.ts";
import { getTodos, setTodos } from "../utils/todo-storage.ts";

const inputSchema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().min(1, "Content cannot be empty"),
        status: z.enum(["pending", "in_progress", "completed"]),
        activeForm: z.string().min(1, "Active form cannot be empty"),
      }),
    )
    .describe("The updated todo list"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  success: boolean;
  error?: string;
  todoCount: number;
}

const DESCRIPTION =
  `Use this tool to create and manage a structured task list for tracking progress.

When to use:
- Complex multi-step tasks requiring 3+ distinct steps
- After receiving new instructions - capture requirements as todos
- When starting work on a task - mark it as in_progress
- After completing a task - mark it as completed

Task states:
- pending: Task not yet started
- in_progress: Currently working on (only ONE at a time)
- completed: Task finished

Important:
- content: Imperative form (e.g., "Run tests", "Fix bug")
- activeForm: Present continuous (e.g., "Running tests", "Fixing bug")
- Mark tasks complete IMMEDIATELY after finishing
- Only ONE task can be in_progress at any time`;

export const TodoWriteTool: Tool<typeof inputSchema, Output> = {
  name: "TodoWrite",
  description: DESCRIPTION,
  inputSchema,

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async *call(input: Input) {
    const result = setTodos(input.todos);

    if (!result.success) {
      yield {
        type: "result" as const,
        data: {
          success: false,
          error: result.error,
          todoCount: getTodos().length,
        },
      };
      return;
    }

    yield {
      type: "result" as const,
      data: {
        success: true,
        todoCount: input.todos.length,
      },
    };
  },

  renderResultForAssistant(output: Output): string {
    if (!output.success) {
      return `Error updating todos: ${output.error}`;
    }
    return "Todos updated successfully. Continue with the current tasks.";
  },

  renderToolUseMessage() {
    return null; // Hide - todo list is shown in result instead
  },
};
