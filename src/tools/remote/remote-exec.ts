/**
 * RemoteExec Tool - Execute commands on remote host
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import type { RemoteExecOutput } from "../../types/remote.ts";
import { connectionManager } from "../../services/remote/mod.ts";

const inputSchema = z.object({
  connection_id: z.string().describe("Connection ID from RemoteConnect"),
  command: z.string().describe("Command to execute on remote host"),
  cwd: z.string().optional().describe(
    "Working directory (default: home directory)",
  ),
  env: z.record(z.string(), z.string()).optional().describe(
    "Environment variables to set",
  ),
  timeout: z.number().default(60000).describe("Timeout in milliseconds"),
});

type Input = z.infer<typeof inputSchema>;

export const RemoteExecTool: Tool<typeof inputSchema, RemoteExecOutput> = {
  name: "RemoteExec",
  description:
    "Execute a command on a connected remote server. Requires an active connection from RemoteConnect.",

  inputSchema,

  isReadOnly: () => false, // Commands can modify remote state
  isConcurrencySafe: () => false,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<RemoteExecOutput>> {
    // Validate connection exists and is ready
    if (!connectionManager.isReady(input.connection_id)) {
      const status = connectionManager.getStatus(input.connection_id);
      yield {
        type: "result",
        data: {
          stdout: "",
          stderr: status
            ? `Connection not ready: ${status.status}`
            : `Connection not found: ${input.connection_id}`,
          exitCode: -1,
          durationMs: 0,
          host: "unknown",
        },
        resultForAssistant: status
          ? `Connection not ready: ${input.connection_id} (status: ${status.status})`
          : `Connection not found: ${input.connection_id}. Use RemoteConnect first.`,
      };
      return;
    }

    yield {
      type: "progress",
      content: `[${input.connection_id}] Executing: ${input.command}`,
    };

    try {
      const result = await connectionManager.execute(input.connection_id, {
        command: input.command,
        cwd: input.cwd,
        env: input.env,
        timeout: input.timeout,
      });

      yield {
        type: "result",
        data: result,
        resultForAssistant: formatExecResult(result),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      yield {
        type: "result",
        data: {
          stdout: "",
          stderr: errorMsg,
          exitCode: -1,
          durationMs: 0,
          host: input.connection_id,
        },
        resultForAssistant: `Execution failed: ${errorMsg}`,
      };
    }
  },

  renderResultForAssistant(output: RemoteExecOutput): string {
    return formatExecResult(output);
  },
};

function formatExecResult(result: RemoteExecOutput): string {
  const lines = [`[${result.host}] Exit code: ${result.exitCode}`];

  if (result.stdout) {
    const stdout = result.stdout.length > 2000
      ? result.stdout.slice(0, 2000) + "\n... (truncated)"
      : result.stdout;
    lines.push(`stdout:\n${stdout}`);
  }

  if (result.stderr) {
    const stderr = result.stderr.length > 500
      ? result.stderr.slice(0, 500) + "\n... (truncated)"
      : result.stderr;
    lines.push(`stderr:\n${stderr}`);
  }

  lines.push(`Duration: ${result.durationMs}ms`);

  return lines.join("\n");
}
