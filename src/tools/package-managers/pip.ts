/**
 * Pip tool - Python package management
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
  const { operation, packages, requirements_file, upgrade, editable, package_name } = input;

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
  description: `Python package manager for installing and managing packages.

Operations:
- install: Install packages (packages, requirements_file, upgrade, editable)
- uninstall: Remove packages
- list: List installed packages
- freeze: Output requirements format
- show: Show package information

Use for: Standard Python projects, requirements.txt based workflows.
Timeouts: install allows up to 15 minutes for large packages.`,

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

    // Start output display for install/uninstall operations
    const needsStreaming = ["install", "uninstall"].includes(input.operation);
    if (needsStreaming && context.outputDisplay) {
      const label = `pip ${input.operation}`;
      context.outputDisplay.start(label, timeout);
    }

    // Use streaming execution
    let result: CommandResult | undefined;
    for await (const item of executeCommandStreaming(
      cmd,
      context.cwd,
      timeout,
      context.abortController,
    )) {
      if ("stream" in item) {
        // Streaming line - yield for display
        yield { type: "streaming_output", line: item };
      } else {
        // Final result
        result = item;
      }
    }

    // Stop output display
    if (needsStreaming && context.outputDisplay) {
      context.outputDisplay.stop();
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
  },

  renderResultForAssistant(output: Output): string {
    return formatResultForAssistant(output, `pip ${output.operation}`);
  },

  renderToolUseMessage(input: Input, { verbose }) {
    const { operation, packages, requirements_file, package_name } = input;

    if (verbose) {
      const cmd = buildCommand(input);
      return cmd.join(" ");
    }

    // Concise mode
    if (packages?.length) {
      const pkgList =
        packages.length > 3
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
