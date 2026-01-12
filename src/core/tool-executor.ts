/**
 * Tool executor with concurrency management
 * Executes tools respecting their concurrency safety settings
 */

import type { Tool, ToolContext } from "../types/tool.ts";
import type { ContentBlock, Message } from "../types/message.ts";
import { createUserMessage } from "./messages.ts";
import { isPlanMode, isToolAllowedInPlanMode } from "../utils/plan-mode.ts";
import { emitReminderEvent } from "../services/system-reminder.ts";
import { loggerService } from "../services/mod.ts";

interface QueueEntry {
  id: string;
  block: ContentBlock;
  status: "queued" | "executing" | "completed";
  isConcurrencySafe: boolean;
  results: Message[];
  durationMs: number;
}

export class ToolExecutor {
  private queue: QueueEntry[] = [];

  constructor(
    private tools: Tool[],
    private context: ToolContext,
  ) {}

  /**
   * Execute all tool use blocks
   * Handles concurrency based on tool settings
   */
  async *executeAll(
    toolUseBlocks: ContentBlock[],
  ): AsyncGenerator<Message> {
    // Build queue
    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;

      const tool = this.tools.find((t) => t.name === block.name);
      let isConcurrencySafe = false;

      if (tool) {
        const parseResult = tool.inputSchema.safeParse(block.input);
        if (parseResult.success) {
          isConcurrencySafe = tool.isConcurrencySafe(parseResult.data);
        }
      }

      this.queue.push({
        id: block.id,
        block,
        status: "queued",
        isConcurrencySafe,
        results: [],
        durationMs: 0,
      });
    }

    // Execute all tools
    await this.processQueue();

    // Yield results in order
    for (const entry of this.queue) {
      for (const message of entry.results) {
        yield message;
      }
    }
  }

  private async processQueue(): Promise<void> {
    const executing: Promise<void>[] = [];

    // Create abort promise once for reuse
    const abortPromise = new Promise<void>((resolve) => {
      if (this.context.abortController.signal.aborted) {
        resolve();
        return;
      }
      this.context.abortController.signal.addEventListener("abort", () => resolve(), { once: true });
    });

    for (const entry of this.queue) {
      // Check abort before starting new tools
      if (this.context.abortController.signal.aborted) break;

      if (entry.status !== "queued") continue;

      if (this.canExecute(entry.isConcurrencySafe)) {
        const promise = this.executeTool(entry);
        executing.push(promise);

        // If not concurrency safe, wait for it (but race against abort)
        if (!entry.isConcurrencySafe) {
          await Promise.race([promise, abortPromise]);
          // Check abort after each non-concurrent tool
          if (this.context.abortController.signal.aborted) break;
        }
      }
    }

    // Race remaining concurrent tools against abort
    if (executing.length > 0 && !this.context.abortController.signal.aborted) {
      await Promise.race([
        Promise.all(executing),
        abortPromise,
      ]);
    }
  }

  private canExecute(isConcurrencySafe: boolean): boolean {
    const currentlyExecuting = this.queue.filter((e) =>
      e.status === "executing"
    );

    // Can always start if nothing is executing
    if (currentlyExecuting.length === 0) {
      return true;
    }

    // Can only run concurrently if both this and all executing tools are safe
    return isConcurrencySafe &&
      currentlyExecuting.every((e) => e.isConcurrencySafe);
  }

  private async executeTool(entry: QueueEntry): Promise<void> {
    entry.status = "executing";
    const startTime = Date.now();
    const { block } = entry;

    if (block.type !== "tool_use") {
      entry.status = "completed";
      return;
    }

    const tool = this.tools.find((t) => t.name === block.name);
    const hooks = loggerService.getHooks();

    // Unknown tool
    if (!tool) {
      entry.durationMs = Date.now() - startTime;
      entry.results.push(
        createUserMessage([
          {
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: Unknown tool "${block.name}"`,
            is_error: true,
            durationMs: entry.durationMs,
          },
        ]),
      );
      entry.status = "completed";
      return;
    }

    // Validate input
    const parseResult = tool.inputSchema.safeParse(block.input);
    if (!parseResult.success) {
      entry.durationMs = Date.now() - startTime;
      entry.results.push(
        createUserMessage([
          {
            type: "tool_result",
            tool_use_id: block.id,
            content: `Validation error: ${parseResult.error.message}`,
            is_error: true,
            durationMs: entry.durationMs,
          },
        ]),
      );
      entry.status = "completed";
      return;
    }

    // Check plan mode restrictions
    if (isPlanMode()) {
      const isReadOnly = tool.isReadOnly(parseResult.data);
      const filePath = (parseResult.data as Record<string, unknown>)
        .file_path as string | undefined;

      if (!isToolAllowedInPlanMode(block.name, isReadOnly, filePath)) {
        entry.durationMs = Date.now() - startTime;
        entry.results.push(
          createUserMessage([
            {
              type: "tool_result",
              tool_use_id: block.id,
              content:
                `Error: Tool "${block.name}" is not allowed in plan mode. Only read-only tools and editing the plan file are allowed.`,
              is_error: true,
              durationMs: entry.durationMs,
            },
          ]),
        );
        entry.status = "completed";
        return;
      }
    }

    // Run custom validation if defined
    if (tool.validateInput) {
      const validation = await tool.validateInput(
        parseResult.data,
        this.context,
      );
      if (!validation.result) {
        entry.durationMs = Date.now() - startTime;
        entry.results.push(
          createUserMessage([
            {
              type: "tool_result",
              tool_use_id: block.id,
              content: `Validation error: ${
                validation.message || "Unknown error"
              }`,
              is_error: true,
              durationMs: entry.durationMs,
            },
          ]),
        );
        entry.status = "completed";
        return;
      }
    }

    // Execute tool
    hooks.onToolStart(block.name, parseResult.data);
    try {
      for await (const result of tool.call(parseResult.data, this.context)) {
        if (this.context.abortController.signal.aborted) {
          hooks.onAbort("User interrupted");
          entry.durationMs = Date.now() - startTime;
          entry.results.push(
            createUserMessage([
              {
                type: "tool_result",
                tool_use_id: block.id,
                content: "Execution interrupted",
                is_error: true,
                durationMs: entry.durationMs,
              },
            ]),
          );
          break;
        }

        if (result.type === "progress") {
          hooks.onToolProgress(block.name, result.content);
          continue;
        }

        if (result.type === "streaming_output") {
          // Pass streaming output to display controller
          if (this.context.outputDisplay) {
            this.context.outputDisplay.addLine(result.line);
          }
          continue;
        }

        // Emit events based on tool type
        this.emitToolEvents(block.name, parseResult.data as Record<string, unknown>);

        // Log tool completion
        entry.durationMs = Date.now() - startTime;
        hooks.onToolComplete(block.name, result.data, entry.durationMs);

        // Result
        const content = result.resultForAssistant ||
          tool.renderResultForAssistant(result.data);

        entry.results.push(
          createUserMessage([
            {
              type: "tool_result",
              tool_use_id: block.id,
              content: typeof content === "string"
                ? content
                : JSON.stringify(content),
              durationMs: entry.durationMs,
            },
          ]),
        );
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      hooks.onToolError(block.name, errorObj);
      entry.durationMs = Date.now() - startTime;
      entry.results.push(
        createUserMessage([
          {
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: ${errorObj.message}`,
            is_error: true,
            durationMs: entry.durationMs,
          },
        ]),
      );
    }

    entry.status = "completed";
  }

  /**
   * Emit reminder events based on tool execution
   */
  private emitToolEvents(
    toolName: string,
    input: Record<string, unknown>,
  ): void {
    switch (toolName) {
      case "Read":
        emitReminderEvent("file:read", { filePath: input.file_path });
        break;
      case "Edit":
      case "Write":
        emitReminderEvent("file:edited", { filePath: input.file_path });
        break;
      case "TodoWrite":
        emitReminderEvent("todo:changed", {});
        break;
    }
  }
}
