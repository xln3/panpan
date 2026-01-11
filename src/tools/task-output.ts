/**
 * TaskOutput tool - retrieve results from background tasks
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";
import type { TaskOutputResult } from "../types/agent.ts";
import {
  getBackgroundTask,
  waitForBackgroundTask,
} from "../utils/background-tasks.ts";

const inputSchema = z.object({
  task_id: z.string().min(1).describe("The task ID to get output from"),
  block: z
    .boolean()
    .default(true)
    .describe("Whether to wait for task completion"),
  timeout: z
    .number()
    .min(0)
    .max(600000)
    .default(30000)
    .describe("Max wait time in ms (default 30000)"),
});

type Input = z.infer<typeof inputSchema>;

/**
 * TaskOutput tool - retrieves output from background tasks
 */
export const TaskOutputTool: Tool<typeof inputSchema, TaskOutputResult> = {
  name: "TaskOutput",
  description: `Retrieves output from a running or completed background task.

Usage:
- Takes a task_id parameter identifying the task
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Returns task output along with status information`,

  inputSchema,

  isReadOnly: () => true,

  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<TaskOutputResult>> {
    const { task_id, block, timeout } = input;

    // Check if task exists
    const task = getBackgroundTask(task_id);
    if (!task) {
      yield {
        type: "result",
        data: {
          retrieval_status: "not_found",
        },
        resultForAssistant: `Task not found: ${task_id}`,
      };
      return;
    }

    // If not blocking or already completed, return immediately
    if (!block || task.status !== "running") {
      yield {
        type: "result",
        data: {
          retrieval_status: task.status === "running" ? "not_ready" : "success",
          task,
        },
      };
      return;
    }

    // Wait for completion
    yield { type: "progress", content: `Waiting for task ${task_id}...` };

    const result = await waitForBackgroundTask(task_id, timeout);

    yield {
      type: "result",
      data: {
        retrieval_status: result.status,
        task: result.task,
      },
    };
  },

  renderResultForAssistant(output: TaskOutputResult): string {
    if (output.retrieval_status === "not_found") {
      return "Task not found";
    }

    if (output.retrieval_status === "not_ready") {
      return `Task ${output.task?.taskId} is still running`;
    }

    if (output.retrieval_status === "timeout") {
      return `Timeout waiting for task ${output.task?.taskId}. Task is still running.`;
    }

    const task = output.task;
    if (!task) {
      return "No task data";
    }

    if (task.status === "failed") {
      return `Task failed: ${task.error}`;
    }

    if (task.status === "killed") {
      return "Task was killed";
    }

    return task.result || "(No result)";
  },

  renderToolUseMessage(input) {
    const { task_id, block } = input;
    return block === false ? `${task_id} (non-blocking)` : task_id;
  },
};
