/**
 * RemoteDisconnect Tool - Disconnect from remote host
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { connectionManager } from "../../services/remote/mod.ts";

const inputSchema = z.object({
  connection_id: z.string().describe("Connection ID to disconnect"),
});

type Input = z.infer<typeof inputSchema>;

interface DisconnectOutput {
  connectionId: string;
  disconnected: boolean;
  error?: string;
}

export const RemoteDisconnectTool: Tool<typeof inputSchema, DisconnectOutput> =
  {
    name: "RemoteDisconnect",
    description:
      "Disconnect from a remote server and cleanup resources. Always disconnect when done with remote operations.",

    inputSchema,

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async *call(
      input: Input,
      _context: ToolContext,
    ): AsyncGenerator<ToolYield<DisconnectOutput>> {
      yield {
        type: "progress",
        content: `Disconnecting: ${input.connection_id}`,
      };

      try {
        await connectionManager.disconnect(input.connection_id);

        yield {
          type: "result",
          data: {
            connectionId: input.connection_id,
            disconnected: true,
          },
          resultForAssistant: `Disconnected from ${input.connection_id}`,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        yield {
          type: "result",
          data: {
            connectionId: input.connection_id,
            disconnected: false,
            error: errorMsg,
          },
          resultForAssistant:
            `Failed to disconnect ${input.connection_id}: ${errorMsg}`,
        };
      }
    },

    renderResultForAssistant(output: DisconnectOutput): string {
      if (output.error) {
        return `Disconnect error: ${output.error}`;
      }
      return output.disconnected
        ? `Disconnected: ${output.connectionId}`
        : `Failed to disconnect: ${output.connectionId}`;
    },
  };

// ============================================================================
// RemoteList - List all connections (bonus utility)
// ============================================================================

const listInputSchema = z.object({});

interface ListOutput {
  connections: Array<{
    id: string;
    hostname: string;
    status: string;
    daemonPort?: number;
    connectedAt?: number;
  }>;
}

export const RemoteListTool: Tool<typeof listInputSchema, ListOutput> = {
  name: "RemoteList",
  description: "List all active remote connections and their status.",

  inputSchema: listInputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    _input: z.infer<typeof listInputSchema>,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<ListOutput>> {
    const connections = connectionManager.listConnections();

    yield {
      type: "result",
      data: {
        connections: connections.map((c) => ({
          id: c.host.id,
          hostname: c.host.hostname,
          status: c.status,
          daemonPort: c.daemonPort,
          connectedAt: c.connectedAt,
        })),
      },
      resultForAssistant: connections.length === 0
        ? "No active connections"
        : `Active connections:\n${
          connections.map((c) =>
            `- ${c.host.id}: ${c.host.hostname} (${c.status})`
          ).join("\n")
        }`,
    };
  },

  renderResultForAssistant(output: ListOutput): string {
    if (output.connections.length === 0) {
      return "No active connections";
    }
    return `${output.connections.length} connection(s):\n${
      output.connections.map((c) => `- ${c.id}: ${c.hostname} (${c.status})`)
        .join("\n")
    }`;
  },
};
