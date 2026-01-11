/**
 * Common utilities for package manager tools
 * Shared timeout constants, command execution, and environment handling
 */

/**
 * Adaptive timeout constants per package manager (in milliseconds)
 * Based on typical resolver/install speeds
 */
export const TIMEOUTS = {
  // Fast package managers (uv, pixi) - 5 minutes
  UV_INSTALL: 5 * 60 * 1000,
  UV_SYNC: 5 * 60 * 1000,
  PIXI_INSTALL: 5 * 60 * 1000,
  PIXI_ADD: 5 * 60 * 1000,

  // Medium (pip) - 10 minutes
  PIP_INSTALL: 10 * 60 * 1000,

  // Slow (conda) - 15 minutes
  CONDA_INSTALL: 15 * 60 * 1000,
  CONDA_CREATE: 15 * 60 * 1000,

  // Common operations
  REMOVE: 2 * 60 * 1000, // 2 minutes
  LOCK: 5 * 60 * 1000, // 5 minutes
  LIST: 30 * 1000, // 30 seconds
  INFO: 30 * 1000, // 30 seconds
} as const;

/**
 * Streaming output line
 */
export interface StreamingLine {
  stream: "stdout" | "stderr";
  line: string;
  timestamp: number;
}

/**
 * Command execution result
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

const MAX_OUTPUT = 30000; // characters

/**
 * Read lines from a ReadableStream, yielding each line as it comes
 */
async function* readLines(
  stream: ReadableStream<Uint8Array>,
  source: "stdout" | "stderr",
): AsyncGenerator<StreamingLine> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split by newlines and yield complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep the incomplete line in buffer

      for (const line of lines) {
        yield { stream: source, line, timestamp: Date.now() };
      }
    }

    // Yield any remaining content
    if (buffer) {
      yield { stream: source, line: buffer, timestamp: Date.now() };
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Execute a command with streaming output
 * Yields lines as they come, then yields final CommandResult
 */
export async function* executeCommandStreaming(
  cmd: string[],
  cwd: string,
  timeout: number,
  abortController: AbortController,
  env?: Record<string, string>,
): AsyncGenerator<StreamingLine | CommandResult> {
  const start = Date.now();

  // Build environment - inherit current env and merge custom env
  const processEnv = env ? { ...Deno.env.toObject(), ...env } : undefined;

  // Create command
  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: processEnv,
  });

  // Start process
  const process = command.spawn();

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

  // Handle abort
  let aborted = false;
  const abortHandler = () => {
    aborted = true;
    try {
      process.kill("SIGTERM");
    } catch {
      // Process may have already exited
    }
  };

  if (abortController.signal.aborted) {
    aborted = true;
  } else {
    abortController.signal.addEventListener("abort", abortHandler, {
      once: true,
    });
  }

  // Accumulate output for final result
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  try {
    // Create async generators for both streams
    const stdoutGen = readLines(process.stdout, "stdout");
    const stderrGen = readLines(process.stderr, "stderr");

    // Track completion
    let stdoutDone = false;
    let stderrDone = false;

    // Helper to get next item from a generator
    const nextItem = async <T>(
      gen: AsyncGenerator<T>,
      source: string,
    ): Promise<{ source: string; value: T | null; done: boolean }> => {
      const result = await gen.next();
      return { source, value: result.done ? null : result.value, done: !!result.done };
    };

    // Process both streams
    let stdoutPromise = !stdoutDone ? nextItem(stdoutGen, "stdout") : null;
    let stderrPromise = !stderrDone ? nextItem(stderrGen, "stderr") : null;

    while ((!stdoutDone || !stderrDone) && !aborted) {
      const promises: Promise<{ source: string; value: StreamingLine | null; done: boolean }>[] = [];
      if (stdoutPromise) promises.push(stdoutPromise);
      if (stderrPromise) promises.push(stderrPromise);

      if (promises.length === 0) break;

      const result = await Promise.race(promises);

      if (result.done) {
        if (result.source === "stdout") {
          stdoutDone = true;
          stdoutPromise = null;
        } else {
          stderrDone = true;
          stderrPromise = null;
        }
      } else if (result.value) {
        // Accumulate
        if (result.source === "stdout") {
          stdoutLines.push(result.value.line);
          stdoutPromise = nextItem(stdoutGen, "stdout");
        } else {
          stderrLines.push(result.value.line);
          stderrPromise = nextItem(stderrGen, "stderr");
        }

        // Yield streaming line
        yield result.value;
      }
    }

    // Wait for process to complete
    const status = await process.status;
    clearTimeout(timeoutId);

    // Build final result
    let stdout = stdoutLines.join("\n");
    let stderr = stderrLines.join("\n");

    // Truncate if needed
    if (stdout.length > MAX_OUTPUT) {
      stdout = stdout.slice(0, MAX_OUTPUT) + "\n... (truncated)";
    }
    if (stderr.length > MAX_OUTPUT) {
      stderr = stderr.slice(0, MAX_OUTPUT) + "\n... (truncated)";
    }

    yield {
      stdout,
      stderr,
      exitCode: aborted ? -1 : status.code,
      durationMs: Date.now() - start,
      timedOut,
    };
  } finally {
    clearTimeout(timeoutId);
    abortController.signal.removeEventListener("abort", abortHandler);
  }
}

/**
 * Execute a command with timeout and abort handling (non-streaming)
 * For backward compatibility and simple commands
 */
export async function executeCommand(
  cmd: string[],
  cwd: string,
  timeout: number,
  abortController: AbortController,
  env?: Record<string, string>,
): Promise<CommandResult> {
  // Use streaming internally but don't yield lines
  let result: CommandResult | undefined;
  for await (const item of executeCommandStreaming(
    cmd,
    cwd,
    timeout,
    abortController,
    env,
  )) {
    if ("exitCode" in item) {
      result = item;
    }
    // Ignore streaming lines
  }
  return (
    result || {
      stdout: "",
      stderr: "",
      exitCode: -1,
      durationMs: 0,
      timedOut: false,
    }
  );
}

/**
 * Build conda command with environment handling
 * Uses `conda run` to avoid shell activation complexity
 */
export function buildCondaCommand(
  args: string[],
  envName?: string,
  envPath?: string,
): string[] {
  // For commands that need to run in an environment context
  if (envName) {
    return ["conda", "run", "-n", envName, "--no-capture-output", ...args];
  }
  if (envPath) {
    return ["conda", "run", "-p", envPath, "--no-capture-output", ...args];
  }
  return ["conda", ...args];
}

/**
 * Build pip command with environment handling
 */
export function buildPipCommand(
  args: string[],
  pythonPath?: string,
  venvPath?: string,
): string[] {
  if (venvPath) {
    // Use the venv's pip directly
    const pipPath = `${venvPath}/bin/pip`;
    return [pipPath, ...args];
  }
  if (pythonPath) {
    // Use python -m pip
    return [pythonPath, "-m", "pip", ...args];
  }
  return ["pip", ...args];
}

/**
 * Format result for assistant (shared rendering logic)
 */
export function formatResultForAssistant(
  result: CommandResult,
  operation: string,
): string {
  const parts: string[] = [];

  if (result.timedOut) {
    parts.push(`(${operation} timed out)`);
  }

  if (result.stdout) {
    parts.push(result.stdout);
  }

  if (result.stderr) {
    // Only label stderr when the command failed (exit code != 0)
    // Many tools (git, uv, pip, etc.) write normal progress to stderr
    if (result.exitCode !== 0) {
      parts.push(`[stderr]\n${result.stderr}`);
    } else {
      // On success, include stderr without alarming label
      parts.push(result.stderr);
    }
  }

  if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
    parts.push(`${operation} failed with exit code ${result.exitCode}`);
  }

  return parts.join("\n") || "(no output)";
}
