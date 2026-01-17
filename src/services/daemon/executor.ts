/**
 * Task executor for daemon.
 *
 * Runs the LLM query loop in the daemon process,
 * storing output to a buffer for client streaming.
 */

import { LLMClient } from "../../llm/client.ts";
import { query, type QueryContext } from "../../core/query.ts";
import { getAllTools } from "../../tools/mod.ts";
import type { Message, UserMessage } from "../../types/message.ts";
import type { LLMConfig } from "../../types/llm.ts";
import { OutputBuffer } from "./output-buffer.ts";
import type { ExecuteRequest, ExecutionStatus, TaskStatus } from "./types.ts";
import { DaemonDatabase } from "./database.ts";

/** Active execution state */
interface ActiveExecution {
  taskId: string;
  sessionId: string;
  status: TaskStatus;
  abortController: AbortController;
  buffer: OutputBuffer;
  startedAt: number;
  completedAt?: number;
  promise: Promise<void>;
}

/**
 * Manages task execution in the daemon.
 */
export class TaskExecutor {
  private executions = new Map<string, ActiveExecution>();
  private db: DaemonDatabase;

  constructor(db: DaemonDatabase) {
    this.db = db;
  }

  /**
   * Start executing a task.
   * Returns immediately with task ID; execution runs in background.
   */
  async execute(request: ExecuteRequest): Promise<ExecutionStatus> {
    // Create or get session
    let sessionId = request.sessionId;
    if (!sessionId) {
      const session = this.db.createSession({
        projectRoot: request.projectRoot,
        model: request.model,
      });
      sessionId = session.id;
    }

    // Create task record
    const task = this.db.createTask({
      sessionId,
      type: "execute",
      description: request.prompt.slice(0, 100),
    });

    // Update task to running
    this.db.updateTask(task.id, { status: "running" });

    // Create execution state
    const abortController = new AbortController();
    const buffer = new OutputBuffer();
    const startedAt = Date.now();

    const execution: ActiveExecution = {
      taskId: task.id,
      sessionId,
      status: "running",
      abortController,
      buffer,
      startedAt,
      promise: Promise.resolve(),
    };

    // Start execution in background
    execution.promise = this.runExecution(execution, request);

    this.executions.set(task.id, execution);

    return {
      taskId: task.id,
      sessionId,
      status: "running",
      outputCount: 0,
      startedAt,
    };
  }

  /**
   * Get execution status.
   */
  getStatus(taskId: string): ExecutionStatus | null {
    const execution = this.executions.get(taskId);
    if (!execution) {
      // Check database for completed tasks
      const task = this.db.getTask(taskId);
      if (!task) return null;

      return {
        taskId: task.id,
        sessionId: task.sessionId,
        status: task.status,
        outputCount: 0, // No buffer for completed tasks
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      };
    }

    return {
      taskId: execution.taskId,
      sessionId: execution.sessionId,
      status: execution.status,
      outputCount: execution.buffer.getCount(),
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
    };
  }

  /**
   * Get output buffer for a task.
   */
  getBuffer(taskId: string): OutputBuffer | null {
    return this.executions.get(taskId)?.buffer ?? null;
  }

  /**
   * Cancel a running task.
   */
  cancel(taskId: string): boolean {
    const execution = this.executions.get(taskId);
    if (!execution || execution.status !== "running") {
      return false;
    }

    execution.abortController.abort();
    execution.status = "cancelled";
    execution.buffer.append("status", "Task cancelled");

    this.db.updateTask(taskId, {
      status: "cancelled",
      completedAt: Date.now(),
    });

    return true;
  }

  /**
   * Run the actual execution (internal).
   */
  private async runExecution(
    execution: ActiveExecution,
    request: ExecuteRequest,
  ): Promise<void> {
    const { buffer, abortController } = execution;

    try {
      buffer.append("status", "Starting execution...");

      // Build LLM config
      const llmConfig: LLMConfig = {
        model: request.model,
        baseUrl: request.llmConfig?.baseUrl ??
          Deno.env.get("PANPAN_BASE_URL") ??
          Deno.env.get("OPENAI_BASE_URL") ??
          "https://api.openai.com/v1",
        apiKey: request.llmConfig?.apiKey ??
          Deno.env.get("PANPAN_API_KEY") ??
          Deno.env.get("OPENAI_API_KEY") ??
          "",
        temperature: request.llmConfig?.temperature,
        maxTokens: request.llmConfig?.maxTokens,
      };

      // Create LLM client
      const llmClient = new LLMClient(llmConfig);

      // Get tools
      const tools = getAllTools();

      // Build initial user message
      const userMessage: UserMessage = {
        type: "user",
        uuid: crypto.randomUUID(),
        message: {
          role: "user",
          content: request.prompt,
        },
      };

      // Build query context
      const queryContext: QueryContext = {
        abortController,
        tools,
        readFileTimestamps: {},
        cwd: request.projectRoot,
        llmConfig,
      };

      // Build system prompt
      const systemPrompt = [
        `You are an AI assistant helping with tasks in the project at ${request.projectRoot}.`,
        ...(request.systemPrompt ?? []),
      ];

      buffer.append("status", "Calling LLM...");

      // Run query loop
      for await (const message of query(
        [userMessage],
        systemPrompt,
        llmClient,
        queryContext,
      )) {
        this.messageToChunks(message, buffer);
      }

      // Mark as completed
      execution.status = "completed";
      execution.completedAt = Date.now();
      buffer.append("status", "Execution completed");

      this.db.updateTask(execution.taskId, {
        status: "completed",
        completedAt: execution.completedAt,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (abortController.signal.aborted) {
        execution.status = "cancelled";
        buffer.append("status", "Execution cancelled");
      } else {
        execution.status = "failed";
        buffer.append("error", errorMessage);

        this.db.updateTask(execution.taskId, {
          status: "failed",
          error: errorMessage,
          completedAt: Date.now(),
        });
      }

      execution.completedAt = Date.now();
    }
  }

  /**
   * Convert a Message to OutputChunks.
   */
  private messageToChunks(message: Message, buffer: OutputBuffer): void {
    switch (message.type) {
      case "assistant": {
        for (const block of message.message.content) {
          switch (block.type) {
            case "text":
              buffer.append("text", block.text);
              break;
            case "thinking":
              buffer.append("thinking", block.thinking);
              break;
            case "tool_use":
              buffer.append("tool_use", JSON.stringify({
                id: block.id,
                name: block.name,
                input: block.input,
              }), { toolName: block.name });
              break;
            case "tool_result":
              buffer.append("tool_result", block.content, {
                toolUseId: block.tool_use_id,
                isError: block.is_error,
              });
              break;
          }
        }
        break;
      }

      case "user": {
        // Tool results from user messages
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              buffer.append("tool_result", block.content, {
                toolUseId: block.tool_use_id,
                isError: block.is_error,
              });
            }
          }
        }
        break;
      }

      case "progress": {
        buffer.append("text", message.content, {
          toolUseId: message.toolUseId,
          isProgress: true,
        });
        break;
      }
    }
  }

  /**
   * Clean up completed executions older than maxAge.
   */
  cleanup(maxAgeMs = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [taskId, execution] of this.executions) {
      if (
        execution.completedAt &&
        now - execution.completedAt > maxAgeMs
      ) {
        execution.buffer.clear();
        this.executions.delete(taskId);
      }
    }
  }

  /**
   * Get all active task IDs.
   */
  getActiveTaskIds(): string[] {
    return [...this.executions.keys()].filter(
      (id) => this.executions.get(id)?.status === "running",
    );
  }
}
