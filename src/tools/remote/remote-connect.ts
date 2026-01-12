/**
 * RemoteConnect Tool - Establish SSH connection to remote host
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { connectionManager } from "../../services/remote/mod.ts";

const inputSchema = z.object({
  hostname: z.string().describe("Remote server hostname or IP address"),
  port: z.number().default(22).describe("SSH port (default: 22)"),
  username: z.string().describe("SSH username"),
  auth_method: z.enum(["key", "password", "agent"]).default("key").describe(
    "Authentication method: key (default), password, or agent",
  ),
  key_path: z.string().optional().describe(
    "Path to SSH private key (for key-based auth)",
  ),
  connection_id: z.string().optional().describe(
    "Custom connection ID (default: username@hostname:port)",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface ConnectOutput {
  connectionId: string;
  status: string;
  daemonPort?: number;
  error?: string;
}

export const RemoteConnectTool: Tool<typeof inputSchema, ConnectOutput> = {
  name: "RemoteConnect",
  description:
    "Connect to a remote server via SSH and start the daemon for subsequent operations. Returns a connection ID for use with other Remote* tools.",

  inputSchema,

  isReadOnly: () => true, // Doesn't modify local filesystem
  isConcurrencySafe: () => false, // Connection state changes

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<ConnectOutput>> {
    yield {
      type: "progress",
      content:
        `Connecting to ${input.username}@${input.hostname}:${input.port}...`,
    };

    try {
      const connectionId = await connectionManager.connect({
        id: input.connection_id ||
          `${input.username}@${input.hostname}:${input.port}`,
        hostname: input.hostname,
        port: input.port,
        username: input.username,
        authMethod: input.auth_method,
        keyPath: input.key_path,
      });

      const status = connectionManager.getStatus(connectionId);

      yield {
        type: "result",
        data: {
          connectionId,
          status: status?.status || "unknown",
          daemonPort: status?.daemonPort,
        },
        resultForAssistant:
          `Connected to ${input.hostname}, connection ID: ${connectionId}, daemon port: ${status?.daemonPort}`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      yield {
        type: "result",
        data: {
          connectionId: "",
          status: "error",
          error: errorMsg,
        },
        resultForAssistant: `Connection failed: ${errorMsg}`,
      };
    }
  },

  renderResultForAssistant(output: ConnectOutput): string {
    if (output.error) {
      return `Connection error: ${output.error}`;
    }
    if (output.status === "ready") {
      return `Connected: ${output.connectionId} (daemon port: ${output.daemonPort})`;
    }
    return `Connection status: ${output.status}`;
  },
};
