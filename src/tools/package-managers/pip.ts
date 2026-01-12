/**
 * Pip tool - Python package management with automatic retry and mirror switching
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import {
  buildPipCommand,
  type CommandResult,
  executeCommandStreaming,
  formatResultForAssistant,
  TIMEOUTS,
} from "./common.ts";
import {
  type DiagnosticResult,
  executeWithDiagnostics,
} from "./diagnostic-executor.ts";

const pipOperations = z.enum([
  "install",
  "uninstall",
  "list",
  "freeze",
  "show",
]);

const inputSchema = z.object({
  operation: pipOperations.describe("Pip operation to perform"),

  // For install/uninstall
  packages: z
    .array(z.string())
    .optional()
    .describe('Package specs (e.g., ["torch>=2.0", "numpy"])'),

  // For install
  requirements_file: z
    .string()
    .optional()
    .describe("Path to requirements.txt"),
  upgrade: z.boolean().optional().describe("Upgrade packages"),
  editable: z
    .string()
    .optional()
    .describe("Install in editable mode (path to package)"),

  // Environment specification
  python_path: z.string().optional().describe("Path to python executable"),
  venv_path: z.string().optional().describe("Path to virtual environment"),

  // For show
  package_name: z.string().optional().describe("Package name to show info for"),
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
    case "install":
      return TIMEOUTS.PIP_INSTALL; // 10 minutes for pip
    case "uninstall":
      return TIMEOUTS.REMOVE;
    default:
      return TIMEOUTS.LIST;
  }
}

function buildCommand(input: Input): string[] {
  const {
    operation,
    packages,
    requirements_file,
    upgrade,
    editable,
    package_name,
  } = input;

  switch (operation) {
    case "install": {
      const args = ["install"];
      if (upgrade) args.push("--upgrade");
      if (requirements_file) {
        args.push("-r", requirements_file);
      }
      if (editable) {
        args.push("-e", editable);
      }
      if (packages?.length) {
        args.push(...packages);
      }
      return buildPipCommand(args, input.python_path, input.venv_path);
    }

    case "uninstall": {
      const args = ["uninstall", "-y"];
      if (packages?.length) {
        args.push(...packages);
      }
      return buildPipCommand(args, input.python_path, input.venv_path);
    }

    case "list":
      return buildPipCommand(["list"], input.python_path, input.venv_path);

    case "freeze":
      return buildPipCommand(["freeze"], input.python_path, input.venv_path);

    case "show":
      return buildPipCommand(
        ["show", package_name || ""],
        input.python_path,
        input.venv_path,
      );

    default:
      return buildPipCommand([operation], input.python_path, input.venv_path);
  }
}

export const PipTool: Tool<typeof inputSchema, Output> = {
  name: "Pip",
  description:
    `Python package manager with automatic retry and mirror switching.

Operations:
- install: Install packages (auto-retries with mirrors on timeout)
- uninstall: Remove packages
- list: List installed packages
- freeze: Output requirements format
- show: Show package information

Features:
- Automatic timeout detection and mirror switching
- Supports Tsinghua, Aliyun, USTC mirrors
- Detailed diagnostics on failure`,

  inputSchema,

  isReadOnly: (input) => {
    if (!input?.operation) return false;
    return ["list", "freeze", "show"].includes(input.operation);
  },

  isConcurrencySafe: (input) => {
    if (!input?.operation) return false;
    return ["list", "freeze", "show"].includes(input.operation);
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const timeout = getTimeout(input.operation);
    const cmd = buildCommand(input);

    // Read-only operations don't need diagnostic enhancement
    const isReadOnly = ["list", "freeze", "show"].includes(input.operation);

    if (isReadOnly) {
      // Use simple streaming execution for read operations
      let result: CommandResult | undefined;
      for await (
        const item of executeCommandStreaming(
          cmd,
          context.cwd,
          timeout,
          context.abortController,
        )
      ) {
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
      context.outputDisplay.start(`pip ${input.operation}`, timeout);
    }

    let result: DiagnosticResult | undefined;

    for await (
      const item of executeWithDiagnostics(
        cmd,
        context.cwd,
        timeout,
        context.abortController,
        { tool: "pip", maxAttempts: 3 },
      )
    ) {
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
    let result = formatResultForAssistant(output, `pip ${output.operation}`);
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
    const { operation, packages, requirements_file, package_name } = input;

    if (verbose) {
      const cmd = buildCommand(input);
      return cmd.join(" ");
    }

    // Concise mode
    if (packages?.length) {
      const pkgList = packages.length > 3
        ? `${packages.slice(0, 3).join(", ")}... (${packages.length} total)`
        : packages.join(", ");
      return `${operation}: ${pkgList}`;
    }
    if (requirements_file) {
      return `${operation}: -r ${requirements_file}`;
    }
    if (package_name) {
      return `${operation}: ${package_name}`;
    }
    return operation;
  },
};
