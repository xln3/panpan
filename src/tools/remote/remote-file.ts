/**
 * RemoteFile Tools - Read and write files on remote host
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { connectionManager } from "../../services/remote/mod.ts";

// ============================================================================
// RemoteFileRead
// ============================================================================

const readInputSchema = z.object({
  connection_id: z.string().describe("Connection ID from RemoteConnect"),
  path: z.string().describe("Absolute path to the file on remote host"),
});

type ReadInput = z.infer<typeof readInputSchema>;

interface ReadOutput {
  content: string;
  path: string;
  host: string;
  error?: string;
}

export const RemoteFileReadTool: Tool<typeof readInputSchema, ReadOutput> = {
  name: "RemoteFileRead",
  description:
    "Read a file from a connected remote server. Use absolute paths.",

  inputSchema: readInputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    input: ReadInput,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<ReadOutput>> {
    // Validate connection
    if (!connectionManager.isReady(input.connection_id)) {
      yield {
        type: "result",
        data: {
          content: "",
          path: input.path,
          host: input.connection_id,
          error: `Connection not ready: ${input.connection_id}`,
        },
        resultForAssistant:
          `Connection not ready: ${input.connection_id}. Use RemoteConnect first.`,
      };
      return;
    }

    yield {
      type: "progress",
      content: `[${input.connection_id}] Reading: ${input.path}`,
    };

    try {
      const content = await connectionManager.readFile(
        input.connection_id,
        input.path,
      );

      yield {
        type: "result",
        data: {
          content,
          path: input.path,
          host: input.connection_id,
        },
        resultForAssistant: formatReadResult(
          input.connection_id,
          input.path,
          content,
        ),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      yield {
        type: "result",
        data: {
          content: "",
          path: input.path,
          host: input.connection_id,
          error: errorMsg,
        },
        resultForAssistant:
          `[${input.connection_id}] Failed to read ${input.path}: ${errorMsg}`,
      };
    }
  },

  renderResultForAssistant(output: ReadOutput): string {
    if (output.error) {
      return `[${output.host}] Error reading ${output.path}: ${output.error}`;
    }
    return formatReadResult(output.host, output.path, output.content);
  },
};

function formatReadResult(host: string, path: string, content: string): string {
  const lines = content.split("\n").length;
  const truncated = content.length > 5000
    ? content.slice(0, 5000) + "\n... (truncated)"
    : content;
  return `[${host}] ${path} (${lines} lines):\n${truncated}`;
}

// ============================================================================
// RemoteFileWrite
// ============================================================================

const writeInputSchema = z.object({
  connection_id: z.string().describe("Connection ID from RemoteConnect"),
  path: z.string().describe("Absolute path to the file on remote host"),
  content: z.string().describe("Content to write to the file"),
});

type WriteInput = z.infer<typeof writeInputSchema>;

interface WriteOutput {
  success: boolean;
  path: string;
  host: string;
  bytesWritten?: number;
  error?: string;
}

export const RemoteFileWriteTool: Tool<typeof writeInputSchema, WriteOutput> = {
  name: "RemoteFileWrite",
  description:
    "Write content to a file on a connected remote server. Use absolute paths. Creates parent directories if needed.",

  inputSchema: writeInputSchema,

  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async *call(
    input: WriteInput,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<WriteOutput>> {
    // Validate connection
    if (!connectionManager.isReady(input.connection_id)) {
      yield {
        type: "result",
        data: {
          success: false,
          path: input.path,
          host: input.connection_id,
          error: `Connection not ready: ${input.connection_id}`,
        },
        resultForAssistant:
          `Connection not ready: ${input.connection_id}. Use RemoteConnect first.`,
      };
      return;
    }

    yield {
      type: "progress",
      content: `[${input.connection_id}] Writing: ${input.path}`,
    };

    try {
      await connectionManager.writeFile(
        input.connection_id,
        input.path,
        input.content,
      );

      yield {
        type: "result",
        data: {
          success: true,
          path: input.path,
          host: input.connection_id,
          bytesWritten: new TextEncoder().encode(input.content).length,
        },
        resultForAssistant:
          `[${input.connection_id}] Successfully wrote ${input.path} (${input.content.length} chars)`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      yield {
        type: "result",
        data: {
          success: false,
          path: input.path,
          host: input.connection_id,
          error: errorMsg,
        },
        resultForAssistant:
          `[${input.connection_id}] Failed to write ${input.path}: ${errorMsg}`,
      };
    }
  },

  renderResultForAssistant(output: WriteOutput): string {
    if (output.error) {
      return `[${output.host}] Error writing ${output.path}: ${output.error}`;
    }
    return `[${output.host}] Wrote ${output.path} (${output.bytesWritten} bytes)`;
  },
};
