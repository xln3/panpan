/**
 * Bash tool - execute shell commands
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";
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
 * Detect python -m venv commands and extract venv path
 * Returns the venv name/path if detected, null otherwise
 */
function detectVenvCommand(command: string): string | null {
  // Match patterns like:
  // python -m venv myenv
  // python3 -m venv myenv
  // python3.10 -m venv myenv
  // /usr/bin/python -m venv myenv
  // Also handles: cd /path && python -m venv myenv
  const venvPattern = /(?:^|&&|\;|\|)\s*(?:[\w\/.-]*python[\d.]*)\s+-m\s+venv\s+([^\s;&|]+)/;
  const match = command.match(venvPattern);
  return match ? match[1] : null;
}

/**
 * Extract the working directory from a command that starts with cd
 * Returns the cd target path if found, null otherwise
 */
function extractCdPath(command: string): string | null {
  // Match: cd /path/to/dir && ...
  const cdPattern = /^cd\s+([^\s;&|]+)/;
  const match = command.match(cdPattern);
  return match ? match[1] : null;
}

/**
 * Validate venv creation command to prevent import shadowing
 */
async function validateVenvCommand(
  command: string,
  cwd: string,
): Promise<{ valid: boolean; warning?: string }> {
  const venvPath = detectVenvCommand(command);
  if (!venvPath) {
    return { valid: true }; // Not a venv command
  }

  // Determine effective working directory
  let effectiveCwd = cwd;
  const cdPath = extractCdPath(command);
  if (cdPath) {
    effectiveCwd = isAbsolute(cdPath) ? cdPath : join(cwd, cdPath);
  }

  // If absolute path outside project, it's fine
  if (isAbsolute(venvPath) && !venvPath.startsWith(effectiveCwd)) {
    return { valid: true };
  }

  // Check if we're in a Python project
  const isProject = await isPythonProject(effectiveCwd);
  if (!isProject) {
    return { valid: true }; // Not a Python project, no shadowing risk
  }

  // We're in a Python project - validate the venv name
  const venvName = basename(venvPath);

  // Rule 1: Inside a project, should use .venv
  if (venvName !== ".venv" && !isAbsolute(venvPath)) {
    // Check if venv name might shadow a source directory
    const potentialSourceDir = join(effectiveCwd, venvName);
    const potentialSourceDirUnderscore = join(effectiveCwd, venvName.replace(/-/g, "_"));

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
          `Use '.venv' instead: \`python -m venv .venv\`. ` +
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

const inputSchema = z.object({
  command: z.string().describe("The command to execute"),
  timeout: z.number().optional().describe(
    "Optional timeout in milliseconds (max 600000)",
  ),
  description: z.string().optional().describe(
    "Clear, concise description of what this command does",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_TIMEOUT = 600000; // 10 minutes
const MAX_OUTPUT = 30000; // characters

export const BashTool: Tool<typeof inputSchema, Output> = {
  name: "Bash",
  description:
    "Executes a given bash command in a shell session. Use for terminal operations like git, npm, docker, etc. Do not use for file operations - use Read/Edit/Write tools instead.",
  inputSchema,

  isReadOnly: (input) => {
    if (!input?.command) return true;
    // Simple heuristic for read-only commands
    const readOnlyPrefixes = [
      "ls",
      "cat",
      "head",
      "tail",
      "grep",
      "find",
      "which",
      "pwd",
      "echo",
      "git status",
      "git log",
      "git diff",
      "git branch",
      "git show",
      "npm list",
      "npm info",
      "npm view",
      "deno info",
      "deno check",
    ];
    const cmd = input.command.trim();
    return readOnlyPrefixes.some((p) => cmd.startsWith(p));
  },

  isConcurrencySafe: function (input) {
    return this.isReadOnly(input);
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
    const start = Date.now();

    // Validate venv creation commands to prevent import shadowing
    let venvWarning: string | undefined;
    const venvValidation = await validateVenvCommand(input.command, context.cwd);
    if (!venvValidation.valid) {
      // Block the command - this would cause import shadowing
      const output: Output = {
        stdout: "",
        stderr: venvValidation.warning || "Invalid venv command",
        exitCode: 1,
        durationMs: 0,
        timedOut: false,
      };

      yield {
        type: "result",
        data: output,
        resultForAssistant: `ERROR: ${venvValidation.warning}\n\nCommand blocked to prevent import shadowing issues.`,
      };
      return;
    }
    venvWarning = venvValidation.warning;

    // Create command
    const cmd = new Deno.Command("bash", {
      args: ["-c", input.command],
      cwd: context.cwd,
      stdout: "piped",
      stderr: "piped",
    });

    // Start process
    const process = cmd.spawn();

    // Setup timeout
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        process.kill("SIGTERM");
      } catch {
        // Process may have already exited
      }
    }, timeout);

    // Handle abort - create promise that resolves when aborted
    let aborted = false;
    const abortPromise = new Promise<null>((resolve) => {
      if (context.abortController.signal.aborted) {
        aborted = true;
        resolve(null);
        return;
      }
      context.abortController.signal.addEventListener("abort", () => {
        aborted = true;
        try {
          process.kill("SIGTERM");
        } catch {
          // Process may have already exited
        }
        resolve(null);
      }, { once: true });
    });

    try {
      // Race process output against abort signal
      const result = await Promise.race([process.output(), abortPromise]);
      clearTimeout(timeoutId);

      // If aborted, return immediately with interrupted result
      if (aborted || result === null) {
        const output: Output = {
          stdout: "",
          stderr: "",
          exitCode: -1,
          durationMs: Date.now() - start,
          timedOut: false,
        };
        yield {
          type: "result",
          data: output,
          resultForAssistant: "Execution interrupted",
        };
        return;
      }

      const decoder = new TextDecoder();
      let stdout = decoder.decode(result.stdout);
      let stderr = decoder.decode(result.stderr);

      // Truncate if needed
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(0, MAX_OUTPUT) + "\n... (truncated)";
      }
      if (stderr.length > MAX_OUTPUT) {
        stderr = stderr.slice(0, MAX_OUTPUT) + "\n... (truncated)";
      }

      const output: Output = {
        stdout,
        stderr,
        exitCode: result.code,
        durationMs: Date.now() - start,
        timedOut,
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
    } finally {
      clearTimeout(timeoutId);
    }
  },

  renderResultForAssistant(output: Output): string {
    const parts: string[] = [];

    if (output.timedOut) {
      parts.push("(Command timed out)");
    }

    if (output.stdout) {
      parts.push(output.stdout);
    }

    if (output.stderr) {
      // Only label stderr when the command failed (exit code != 0)
      // Many tools (git, uv, pip, etc.) write normal progress to stderr
      if (output.exitCode !== 0) {
        parts.push(`[stderr]\n${output.stderr}`);
      } else {
        // On success, include stderr without alarming label
        parts.push(output.stderr);
      }
    }

    if (output.exitCode !== 0 && !output.stdout && !output.stderr) {
      parts.push(`Command exited with code ${output.exitCode}`);
    }

    return parts.join("\n") || "(no output)";
  },

  renderToolUseMessage(input: Input, { verbose }) {
    const { command, description, timeout } = input;
    const timeoutStr = timeout
      ? ` (timeout=${Math.round(timeout / 1000)}s)`
      : "";

    // Verbose mode: show full command
    if (verbose) {
      if (description) {
        return `${command}${timeoutStr} — ${description}`;
      }
      return `${command}${timeoutStr}`;
    }

    // Concise mode: prefer description, or truncated command
    if (description) {
      return `${description}${timeoutStr}`;
    }

    const cmd = command.length > 80 ? command.slice(0, 79) + "…" : command;
    return `${cmd}${timeoutStr}`;
  },
};
