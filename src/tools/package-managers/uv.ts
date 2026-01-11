/**
 * Uv tool - Fast Python package manager
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import {
  type CommandResult,
  executeCommandStreaming,
  formatResultForAssistant,
  TIMEOUTS,
} from "./common.ts";
import { join, isAbsolute, basename } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * Check if a directory is a Python project (contains setup.py, pyproject.toml, or setup.cfg)
 */
async function isPythonProject(dir: string): Promise<boolean> {
  const projectFiles = ["setup.py", "pyproject.toml", "setup.cfg"];
  for (const file of projectFiles) {
    try {
      await Deno.stat(join(dir, file));
      return true;
    } catch {
      // File doesn't exist, continue checking
    }
  }
  return false;
}

/**
 * Check if a directory contains a Python package (has __init__.py)
 */
async function isPythonPackage(dir: string): Promise<boolean> {
  try {
    await Deno.stat(join(dir, "__init__.py"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate venv path to prevent import shadowing issues
 * Returns null if valid, or an error message if invalid
 */
async function validateVenvPath(
  venvPath: string | undefined,
  projectDir: string,
): Promise<{ valid: boolean; warning?: string }> {
  const targetPath = venvPath || ".venv";

  // If absolute path outside project, it's fine
  if (isAbsolute(targetPath) && !targetPath.startsWith(projectDir)) {
    return { valid: true };
  }

  // Check if we're in a Python project
  const isProject = await isPythonProject(projectDir);
  if (!isProject) {
    return { valid: true }; // Not a Python project, no shadowing risk
  }

  // We're in a Python project - validate the venv name
  const venvName = basename(targetPath);

  // Rule 1: Inside a project, should use .venv
  if (venvName !== ".venv" && !isAbsolute(targetPath)) {
    // Check if venv name might shadow a source directory
    const potentialSourceDir = join(projectDir, venvName);
    const potentialSourceDirUnderscore = join(projectDir, venvName.replace(/-/g, "_"));

    let shadowsSource = false;
    let shadowedName = "";

    // Check exact match
    if (await isPythonPackage(potentialSourceDir)) {
      shadowsSource = true;
      shadowedName = venvName;
    }
    // Check underscore variant (e.g., venv "my-package" vs source "my_package")
    else if (venvName.includes("-") && await isPythonPackage(potentialSourceDirUnderscore)) {
      shadowsSource = true;
      shadowedName = venvName.replace(/-/g, "_");
    }

    if (shadowsSource) {
      return {
        valid: false,
        warning: `VENV NAMING CONFLICT: Creating venv '${venvName}' inside this Python project will shadow the source package '${shadowedName}'. ` +
          `This causes import errors (ModuleNotFoundError). ` +
          `Use '.venv' instead: \`uv venv\` (default) or \`uv venv .venv\`. ` +
          `Or create venv outside the project with an absolute path.`,
      };
    }

    // Even if no immediate shadowing, warn about non-.venv inside project
    return {
      valid: true, // Allow but warn
      warning: `NOTE: Creating venv '${venvName}' inside a Python project. ` +
        `Recommended: use '.venv' to avoid potential import shadowing issues.`,
    };
  }

  return { valid: true };
}

const uvOperations = z.enum([
  "add",
  "remove",
  "sync",
  "lock",
  "pip",
  "run",
  "venv",
]);

const pipSubcommands = z.enum(["install", "uninstall", "list", "freeze"]);

const inputSchema = z.object({
  operation: uvOperations.describe("Uv operation to perform"),

  // For add/remove
  packages: z
    .array(z.string())
    .optional()
    .describe('Package specs (e.g., ["torch", "numpy>=1.20"])'),
  dev: z.boolean().optional().describe("Add as dev dependency"),

  // For pip subcommand
  pip_command: pipSubcommands
    .optional()
    .describe("Pip subcommand (install, uninstall, list, freeze)"),
  pip_args: z
    .array(z.string())
    .optional()
    .describe("Arguments for pip subcommand"),

  // For run
  command: z.string().optional().describe("Command to run in project environment"),

  // For venv
  python_version: z.string().optional().describe('Python version (e.g., "3.11")'),
  path: z.string().optional().describe("Venv path (default: .venv)"),

  // Working directory override
  project_path: z.string().optional().describe("Project directory path"),
});

type Input = z.infer<typeof inputSchema>;

interface Output extends CommandResult {
  operation: string;
}

function getTimeout(operation: string, pipCommand?: string): number {
  switch (operation) {
    case "add":
      return TIMEOUTS.UV_INSTALL; // 5 minutes for fast uv
    case "remove":
      return TIMEOUTS.REMOVE;
    case "sync":
      return TIMEOUTS.UV_SYNC; // 5 minutes for fast uv
    case "lock":
      return TIMEOUTS.LOCK;
    case "venv":
      return TIMEOUTS.REMOVE; // 2 min is enough for venv creation
    case "run":
      return TIMEOUTS.UV_SYNC; // 5 min for arbitrary commands
    case "pip":
      // Pip subcommand timeout depends on the operation
      if (pipCommand === "install") return TIMEOUTS.UV_INSTALL;
      if (pipCommand === "uninstall") return TIMEOUTS.REMOVE;
      return TIMEOUTS.LIST;
    default:
      return TIMEOUTS.LIST;
  }
}

function buildCommand(input: Input): string[] {
  const {
    operation,
    packages,
    dev,
    pip_command,
    pip_args,
    command,
    python_version,
    path,
  } = input;

  switch (operation) {
    case "add": {
      const args = ["add"];
      if (dev) args.push("--dev");
      if (packages?.length) args.push(...packages);
      return ["uv", ...args];
    }

    case "remove": {
      const args = ["remove"];
      if (packages?.length) args.push(...packages);
      return ["uv", ...args];
    }

    case "sync":
      return ["uv", "sync"];

    case "lock":
      return ["uv", "lock"];

    case "pip": {
      const args = ["pip", pip_command || "list"];
      if (pip_args?.length) args.push(...pip_args);
      return ["uv", ...args];
    }

    case "run": {
      if (!command) return ["uv", "run", "--help"];
      // Split command into parts for execution
      return ["uv", "run", ...command.split(/\s+/)];
    }

    case "venv": {
      const args = ["venv"];
      if (path) args.push(path);
      if (python_version) args.push("--python", python_version);
      return ["uv", ...args];
    }

    default:
      return ["uv", operation];
  }
}

export const UvTool: Tool<typeof inputSchema, Output> = {
  name: "Uv",
  description: `Fast Python package manager (replacement for pip/pip-tools/virtualenv).

Operations:
- add: Add dependencies to project (packages, dev)
- remove: Remove dependencies from project
- sync: Sync environment with lockfile
- lock: Update lockfile without syncing
- pip: Run uv pip subcommand (pip_command: install/uninstall/list/freeze, pip_args)
- run: Run command in project environment
- venv: Create virtual environment (python_version, path defaults to .venv)

IMPORTANT for venv: Inside Python projects, use .venv (default) to avoid import shadowing.
Creating a venv with a custom name inside a project that has a source package with the same name will be BLOCKED.

Use for: Modern Python projects, fast installs, reproducible environments.
Timeouts: add/sync allow up to 15 minutes for large packages.`,

  inputSchema,

  isReadOnly: (input) => {
    if (!input?.operation) return false;
    if (input.operation === "pip") {
      return ["list", "freeze"].includes(input.pip_command || "");
    }
    return input.operation === "run"; // run is considered read-only (doesn't modify project)
  },

  isConcurrencySafe: (input) => {
    if (!input?.operation) return false;
    if (input.operation === "pip") {
      return ["list", "freeze"].includes(input.pip_command || "");
    }
    return false; // Most uv operations modify state
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const timeout = getTimeout(input.operation, input.pip_command);
    const cmd = buildCommand(input);
    const cwd = input.project_path || context.cwd;

    // Validate venv path before creation to prevent import shadowing
    let venvWarning: string | undefined;
    if (input.operation === "venv") {
      const validation = await validateVenvPath(input.path, cwd);

      if (!validation.valid) {
        // Block the operation - this would cause import shadowing
        const output: Output = {
          operation: input.operation,
          stdout: "",
          stderr: validation.warning || "Invalid venv path",
          exitCode: 1,
          durationMs: 0,
          timedOut: false,
        };

        yield {
          type: "result",
          data: output,
          resultForAssistant: `ERROR: ${validation.warning}\n\nVenv creation blocked to prevent import shadowing issues.`,
        };
        return;
      }

      // Track warning to include in result
      venvWarning = validation.warning;
    }

    // Start output display for long operations
    const needsStreaming = ["add", "sync", "pip"].includes(input.operation) &&
      (input.operation !== "pip" || input.pip_command === "install");
    if (needsStreaming && context.outputDisplay) {
      const label = input.operation === "pip"
        ? `uv pip ${input.pip_command}`
        : `uv ${input.operation}`;
      context.outputDisplay.start(label, timeout);
    }

    // Use streaming execution
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

    // Include venv warning in result if present
    let resultText = this.renderResultForAssistant(output);
    if (venvWarning) {
      resultText = `WARNING: ${venvWarning}\n\n${resultText}`;
    }

    yield {
      type: "result",
      data: output,
      resultForAssistant: resultText,
    };
  },

  renderResultForAssistant(output: Output): string {
    return formatResultForAssistant(output, `uv ${output.operation}`);
  },

  renderToolUseMessage(input: Input, { verbose }) {
    const { operation, packages, pip_command, command, dev } = input;

    if (verbose) {
      const cmd = buildCommand(input);
      return cmd.join(" ");
    }

    // Concise mode
    if (operation === "pip" && pip_command) {
      return `pip ${pip_command}`;
    }
    if (operation === "run" && command) {
      const shortCmd = command.length > 40 ? command.slice(0, 39) + "…" : command;
      return `run: ${shortCmd}`;
    }
    if (packages?.length) {
      const devLabel = dev ? " (dev)" : "";
      const pkgList =
        packages.length > 3
          ? `${packages.slice(0, 3).join(", ")}... (${packages.length} total)`
          : packages.join(", ");
      return `${operation}: ${pkgList}${devLabel}`;
    }
    return operation;
  },
};
