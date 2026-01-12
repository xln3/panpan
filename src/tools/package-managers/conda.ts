/**
 * Conda tool - Conda environment and package management with automatic retry and mirror switching
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
  type DiagnosticResult,
  executeWithDiagnostics,
} from "./diagnostic-executor.ts";

const condaOperations = z.enum([
  "create",
  "install",
  "remove",
  "list",
  "info",
  "env_list",
]);

const inputSchema = z.object({
  operation: condaOperations.describe("Conda operation to perform"),

  // Environment specification (one of these)
  env_name: z.string().optional().describe("Environment name"),
  env_path: z.string().optional().describe("Path to environment"),

  // For create/install/remove
  packages: z
    .array(z.string())
    .optional()
    .describe('Package specs (e.g., ["pytorch=2.0", "numpy", "cudatoolkit"])'),

  // For create
  python_version: z.string().optional().describe(
    'Python version (e.g., "3.11")',
  ),
  channels: z
    .array(z.string())
    .optional()
    .describe('Conda channels (e.g., ["pytorch", "conda-forge"])'),

  // Create from file
  environment_file: z
    .string()
    .optional()
    .describe("Path to environment.yml for conda env create"),
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
    case "create":
      return TIMEOUTS.CONDA_CREATE; // 15 minutes for conda
    case "install":
      return TIMEOUTS.CONDA_INSTALL; // 15 minutes for conda
    case "remove":
      return TIMEOUTS.REMOVE;
    default:
      return TIMEOUTS.LIST;
  }
}

function buildCommand(input: Input): string[] {
  const {
    operation,
    env_name,
    env_path,
    packages,
    python_version,
    channels,
    environment_file,
  } = input;

  // Helper to add -y flag for non-interactive
  const addYes = (args: string[]) => [...args, "-y"];

  // Helper to add environment target
  const addEnv = (args: string[]) => {
    if (env_name) return [...args, "-n", env_name];
    if (env_path) return [...args, "-p", env_path];
    return args;
  };

  // Helper to add channels
  const addChannels = (args: string[]) => {
    if (!channels?.length) return args;
    const channelArgs: string[] = [];
    for (const ch of channels) {
      channelArgs.push("-c", ch);
    }
    return [...args, ...channelArgs];
  };

  switch (operation) {
    case "create": {
      // conda env create -f file.yml or conda create -n name python=X.Y packages
      if (environment_file) {
        // Using conda env create for yml files
        let args = ["env", "create", "-f", environment_file];
        if (env_name) args = [...args, "-n", env_name];
        return ["conda", ...args];
      }

      let args = ["create"];
      args = addEnv(args);
      args = addChannels(args);
      args = addYes(args);

      if (python_version) {
        args.push(`python=${python_version}`);
      }
      if (packages?.length) {
        args.push(...packages);
      }
      return ["conda", ...args];
    }

    case "install": {
      let args = ["install"];
      args = addEnv(args);
      args = addChannels(args);
      args = addYes(args);
      if (packages?.length) {
        args.push(...packages);
      }
      return ["conda", ...args];
    }

    case "remove": {
      let args = ["remove"];
      args = addEnv(args);
      args = addYes(args);
      if (packages?.length) {
        args.push(...packages);
      }
      return ["conda", ...args];
    }

    case "list": {
      let args = ["list"];
      args = addEnv(args);
      return ["conda", ...args];
    }

    case "info":
      return ["conda", "info"];

    case "env_list":
      return ["conda", "env", "list"];

    default:
      return ["conda", operation];
  }
}

export const CondaTool: Tool<typeof inputSchema, Output> = {
  name: "Conda",
  description:
    `Conda environment and package manager with automatic retry and mirror switching.

Operations:
- create: Create new environment (auto-retries with mirrors on timeout)
- install: Install packages into existing environment
- remove: Remove packages from environment
- list: List installed packages in environment
- info: Show conda information
- env_list: List all conda environments

Features:
- Automatic timeout detection and mirror switching
- Supports Tsinghua, Aliyun mirrors
- Detailed diagnostics on failure`,

  inputSchema,

  isReadOnly: (input) => {
    if (!input?.operation) return false;
    return ["list", "info", "env_list"].includes(input.operation);
  },

  isConcurrencySafe: (input) => {
    if (!input?.operation) return false;
    return ["list", "info", "env_list"].includes(input.operation);
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const timeout = getTimeout(input.operation);
    const cmd = buildCommand(input);

    // Read-only operations don't need diagnostic enhancement
    const isReadOnly = ["list", "info", "env_list"].includes(input.operation);

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
      context.outputDisplay.start(`conda ${input.operation}`, timeout);
    }

    let result: DiagnosticResult | undefined;

    for await (
      const item of executeWithDiagnostics(
        cmd,
        context.cwd,
        timeout,
        context.abortController,
        { tool: "conda", maxAttempts: 3 },
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
    let result = formatResultForAssistant(output, `conda ${output.operation}`);
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
    const { operation, env_name, env_path, packages, environment_file } = input;

    if (verbose) {
      const cmd = buildCommand(input);
      return cmd.join(" ");
    }

    // Concise mode
    const envLabel = env_name || env_path || "";
    const envSuffix = envLabel ? ` (${envLabel})` : "";

    if (environment_file) {
      return `${operation}: -f ${environment_file}${envSuffix}`;
    }
    if (packages?.length) {
      const pkgList = packages.length > 3
        ? `${packages.slice(0, 3).join(", ")}... (${packages.length} total)`
        : packages.join(", ");
      return `${operation}: ${pkgList}${envSuffix}`;
    }
    return `${operation}${envSuffix}`;
  },
};
