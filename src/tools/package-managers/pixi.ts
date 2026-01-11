/**
 * Pixi tool - Fast package manager for conda environments with automatic retry and mirror switching
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import {
  type CommandResult,
  executeCommandStreaming,
  formatResultForAssistant,
  TIMEOUTS,
} from "./common.ts";
import {
  executeWithDiagnostics,
  type DiagnosticResult,
} from "./diagnostic-executor.ts";

const pixiOperations = z.enum([
  "add",
  "remove",
  "install",
  "run",
  "list",
  "init",
]);

const inputSchema = z.object({
  operation: pixiOperations.describe("Pixi operation to perform"),

  // For add/remove
  packages: z
    .array(z.string())
    .optional()
    .describe('Package specs (e.g., ["pytorch", "numpy"])'),
  feature: z
    .string()
    .optional()
    .describe("Feature name for optional dependencies"),
  platform: z
    .string()
    .optional()
    .describe('Platform constraint (e.g., "linux-64", "osx-arm64")'),

  // For run
  task: z.string().optional().describe("Task name or command to run"),

  // For init
  name: z.string().optional().describe("Project name for init"),

  // Working directory
  project_path: z.string().optional().describe("Project directory path"),
});

type Input = z.infer<typeof inputSchema>;

interface Output extends CommandResult {
  operation: string;
  /** Number of attempts (only for write operations) */
  attempts?: number;
  /** Applied fix IDs (only for write operations) */
  appliedFixes?: string[];
}

function getTimeout(operation: string): number {
  switch (operation) {
    case "add":
      return TIMEOUTS.PIXI_ADD; // 5 minutes for fast pixi
    case "remove":
      return TIMEOUTS.REMOVE;
    case "install":
      return TIMEOUTS.PIXI_INSTALL; // 5 minutes for fast pixi
    case "run":
      return TIMEOUTS.PIXI_INSTALL; // 5 min for arbitrary tasks
    case "init":
      return TIMEOUTS.LIST;
    default:
      return TIMEOUTS.LIST;
  }
}

function buildCommand(input: Input): string[] {
  const { operation, packages, feature, platform, task, name } = input;

  switch (operation) {
    case "add": {
      const args = ["add"];
      if (feature) args.push("--feature", feature);
      if (platform) args.push("--platform", platform);
      if (packages?.length) args.push(...packages);
      return ["pixi", ...args];
    }

    case "remove": {
      const args = ["remove"];
      if (feature) args.push("--feature", feature);
      if (packages?.length) args.push(...packages);
      return ["pixi", ...args];
    }

    case "install":
      return ["pixi", "install"];

    case "run": {
      if (!task) return ["pixi", "run", "--help"];
      // If task contains spaces, it might be a command rather than a task name
      if (task.includes(" ")) {
        return ["pixi", "run", ...task.split(/\s+/)];
      }
      return ["pixi", "run", task];
    }

    case "list":
      return ["pixi", "list"];

    case "init": {
      const args = ["init"];
      if (name) args.push(name);
      return ["pixi", ...args];
    }

    default:
      return ["pixi", operation];
  }
}

export const PixiTool: Tool<typeof inputSchema, Output> = {
  name: "Pixi",
  description: `Fast conda-based package manager with automatic retry and mirror switching.

Operations:
- add: Add dependencies (auto-retries with mirrors on timeout)
- remove: Remove dependencies
- install: Install project dependencies from lockfile
- run: Run task or command in project environment
- list: List project dependencies
- init: Initialize new pixi project

Features:
- Automatic timeout detection and mirror switching
- Supports Tsinghua, Aliyun mirrors
- Detailed diagnostics on failure`,

  inputSchema,

  isReadOnly: (input) => {
    if (!input?.operation) return false;
    return ["list", "run"].includes(input.operation);
  },

  isConcurrencySafe: (input) => {
    if (!input?.operation) return false;
    return input.operation === "list"; // Only list is safe
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const timeout = getTimeout(input.operation);
    const cmd = buildCommand(input);
    const cwd = input.project_path || context.cwd;

    // Read-only operations don't need diagnostic enhancement
    const isReadOnly = ["list", "run"].includes(input.operation);

    if (isReadOnly) {
      // Use simple streaming execution for read operations
      let result: CommandResult | undefined;
      for await (const item of executeCommandStreaming(
        cmd,
        cwd,
        timeout,
        context.abortController,
      )) {
        if ("stream" in item) {
          yield { type: "streaming_output", line: item };
        } else {
          result = item;
        }
      }

      const output: Output = {
        operation: input.operation,
        ...(result || {
          stdout: "",
          stderr: "",
          exitCode: -1,
          durationMs: 0,
          timedOut: false,
        }),
      };

      yield {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output),
      };
      return;
    }

    // ========== Write operations: use diagnostic executor ==========
    if (context.outputDisplay) {
      context.outputDisplay.start(`pixi ${input.operation}`, timeout);
    }

    let result: DiagnosticResult | undefined;

    for await (const item of executeWithDiagnostics(
      cmd,
      cwd,
      timeout,
      context.abortController,
      { tool: "pixi", maxAttempts: 3 },
    )) {
      if ("stream" in item) {
        yield { type: "streaming_output", line: item };
      } else if ("type" in item && item.type === "progress") {
        yield { type: "progress", content: item.message };
      } else {
        result = item as DiagnosticResult;
      }
    }

    if (context.outputDisplay) {
      context.outputDisplay.stop();
    }

    // Build output
    const output: Output = {
      operation: input.operation,
      stdout: result?.stdout || "",
      stderr: result?.stderr || "",
      exitCode: result?.exitCode ?? -1,
      durationMs: result?.durationMs || 0,
      timedOut: result?.timedOut || false,
      attempts: result?.attempts,
      appliedFixes: result?.appliedFixes,
    };

    // Build assistant message with diagnostic info
    let assistantMessage = this.renderResultForAssistant(output);
    if (result?.diagnosis?.userQuestion) {
      assistantMessage += `\n\n⚠️ ${result.diagnosis.userQuestion}`;
    }

    yield {
      type: "result",
      data: output,
      resultForAssistant: assistantMessage,
    };
  },

  renderResultForAssistant(output: Output): string {
    let result = formatResultForAssistant(output, `pixi ${output.operation}`);
    if (output.attempts && output.attempts > 1) {
      result += `\n(共尝试 ${output.attempts} 次`;
      if (output.appliedFixes?.length) {
        result += `, 已应用修复: ${output.appliedFixes.join(", ")}`;
      }
      result += ")";
    }
    return result;
  },

  renderToolUseMessage(input: Input, { verbose }) {
    const { operation, packages, task, feature } = input;

    if (verbose) {
      const cmd = buildCommand(input);
      return cmd.join(" ");
    }

    // Concise mode
    if (operation === "run" && task) {
      const shortTask = task.length > 40 ? task.slice(0, 39) + "…" : task;
      return `run: ${shortTask}`;
    }
    if (packages?.length) {
      const featureLabel = feature ? ` [${feature}]` : "";
      const pkgList =
        packages.length > 3
          ? `${packages.slice(0, 3).join(", ")}... (${packages.length} total)`
          : packages.join(", ");
      return `${operation}: ${pkgList}${featureLabel}`;
    }
    return operation;
  },
};
