/**
 * Background task manager for async agent execution
 */

import type { BackgroundAgentTask } from "../types/agent.ts";

/**
 * Runtime task with abort controller and completion promise
 */
interface BackgroundTaskRuntime extends BackgroundAgentTask {
  abortController: AbortController;
  done: Promise<void>;
  resolve: () => void;
}

// In-memory storage for background tasks
const backgroundTasks = new Map<string, BackgroundTaskRuntime>();

/**
 * Generate unique task ID
 */
export function generateTaskId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Create and register a new background task
 */
export function createBackgroundTask(
  taskId: string,
  agentType: string,
  description: string,
  prompt: string,
): {
  task: BackgroundAgentTask;
  abortController: AbortController;
  markComplete: (result?: string, error?: string) => void;
} {
  let resolve: () => void;
  const done = new Promise<void>((r) => {
    resolve = r;
  });

  const abortController = new AbortController();

  const task: BackgroundTaskRuntime = {
    taskId,
    agentType,
    description,
    prompt,
    status: "running",
    startedAt: Date.now(),
    abortController,
    done,
    resolve: resolve!,
  };

  backgroundTasks.set(taskId, task);

  const markComplete = (result?: string, error?: string) => {
    task.completedAt = Date.now();
    if (error) {
      task.status = "failed";
      task.error = error;
    } else {
      task.status = "completed";
      task.result = result;
    }
    task.resolve();
  };

  return { task, abortController, markComplete };
}

/**
 * Get task snapshot (without runtime fields)
 */
export function getBackgroundTask(
  taskId: string,
): BackgroundAgentTask | undefined {
  const task = backgroundTasks.get(taskId);
  if (!task) return undefined;

  return {
    taskId: task.taskId,
    agentType: task.agentType,
    description: task.description,
    prompt: task.prompt,
    status: task.status,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    result: task.result,
    error: task.error,
  };
}

/**
 * Wait for a background task to complete
 */
export async function waitForBackgroundTask(
  taskId: string,
  timeoutMs: number = 30000,
): Promise<
  { status: "success" | "timeout" | "not_found"; task?: BackgroundAgentTask }
> {
  const task = backgroundTasks.get(taskId);
  if (!task) {
    return { status: "not_found" };
  }

  if (task.status !== "running") {
    return { status: "success", task: getBackgroundTask(taskId) };
  }

  // Wait with timeout
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const result = await Promise.race([
    task.done.then(() => "done" as const),
    timeoutPromise,
  ]);

  if (result === "timeout") {
    return { status: "timeout", task: getBackgroundTask(taskId) };
  }

  return { status: "success", task: getBackgroundTask(taskId) };
}

/**
 * Kill a background task
 */
export function killBackgroundTask(taskId: string): boolean {
  const task = backgroundTasks.get(taskId);
  if (!task || task.status !== "running") {
    return false;
  }

  task.abortController.abort();
  task.status = "killed";
  task.completedAt = Date.now();
  task.resolve();
  return true;
}

/**
 * Get all background tasks
 */
export function getAllBackgroundTasks(): BackgroundAgentTask[] {
  return Array.from(backgroundTasks.values()).map((task) => ({
    taskId: task.taskId,
    agentType: task.agentType,
    description: task.description,
    prompt: task.prompt,
    status: task.status,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    result: task.result,
    error: task.error,
  }));
}

/**
 * Clear completed tasks
 */
export function clearCompletedTasks(): number {
  let cleared = 0;
  for (const [taskId, task] of backgroundTasks) {
    if (task.status !== "running") {
      backgroundTasks.delete(taskId);
      cleared++;
    }
  }
  return cleared;
}
