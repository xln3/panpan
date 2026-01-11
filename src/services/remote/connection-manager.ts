/**
 * Connection pool manager for remote hosts.
 * Manages multiple connections, handles reconnection, tracks state.
 */

import type {
  RemoteHost,
  RemoteConnection,
  DaemonInfo,
  RemoteExecOutput,
} from "../../types/remote.ts";
import { bootstrapDaemon, type SSHBootstrapOptions } from "./ssh-bootstrap.ts";
import { DaemonClient, type ExecOptions } from "./daemon-client.ts";

/** Internal connection entry with client */
interface ConnectionEntry {
  connection: RemoteConnection;
  client?: DaemonClient;
  token?: string;
}

/**
 * Manages connections to remote hosts.
 *
 * Usage:
 * ```typescript
 * const id = await connectionManager.connect(host);
 * const result = await connectionManager.execute(id, { command: "ls -la" });
 * await connectionManager.disconnect(id);
 * ```
 */
class ConnectionManager {
  private connections = new Map<string, ConnectionEntry>();

  /**
   * Connect to a remote host.
   * Returns the connection ID for subsequent operations.
   */
  async connect(
    host: RemoteHost,
    options?: SSHBootstrapOptions
  ): Promise<string> {
    const connectionId = this.getConnectionId(host);

    // Return existing ready connection
    const existing = this.connections.get(connectionId);
    if (existing?.connection.status === "ready" && existing.client) {
      // Verify connection is still alive
      if (await existing.client.isAlive()) {
        existing.connection.lastActivity = Date.now();
        return connectionId;
      }
      // Connection dead, will reconnect
    }

    // Create new connection entry
    const entry: ConnectionEntry = {
      connection: {
        host,
        status: "connecting",
      },
    };
    this.connections.set(connectionId, entry);

    try {
      // Bootstrap daemon via SSH
      entry.connection.status = "bootstrapping";
      const result = await bootstrapDaemon(host, options);

      if (!result.success || !result.daemonInfo) {
        entry.connection.status = "error";
        entry.connection.error = result.error;
        throw new Error(result.error ?? "Bootstrap failed");
      }

      // Extract token from daemon info
      const daemonInfo = result.daemonInfo as DaemonInfo & { token?: string };
      const token = daemonInfo.token;

      if (!token) {
        entry.connection.status = "error";
        entry.connection.error = "No token in daemon info";
        throw new Error("No token in daemon info");
      }

      // Create daemon client
      const client = new DaemonClient(host.hostname, daemonInfo.port, token);

      // Verify connection with health check
      await client.health();

      // Update connection state
      entry.connection.status = "ready";
      entry.connection.daemonPort = daemonInfo.port;
      entry.connection.daemonPid = daemonInfo.pid;
      entry.connection.connectedAt = Date.now();
      entry.connection.lastActivity = Date.now();
      entry.client = client;
      entry.token = token;

      return connectionId;
    } catch (error) {
      entry.connection.status = "error";
      entry.connection.error =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Execute a command on a connected remote host
   */
  async execute(
    connectionId: string,
    options: ExecOptions
  ): Promise<RemoteExecOutput> {
    const entry = this.getReadyConnection(connectionId);
    entry.connection.lastActivity = Date.now();
    return entry.client!.exec(options);
  }

  /**
   * Read a file from a connected remote host
   */
  async readFile(connectionId: string, path: string): Promise<string> {
    const entry = this.getReadyConnection(connectionId);
    entry.connection.lastActivity = Date.now();
    return entry.client!.readFile(path);
  }

  /**
   * Write a file to a connected remote host
   */
  async writeFile(
    connectionId: string,
    path: string,
    content: string
  ): Promise<void> {
    const entry = this.getReadyConnection(connectionId);
    entry.connection.lastActivity = Date.now();
    return entry.client!.writeFile(path, content);
  }

  /**
   * Disconnect from a remote host
   */
  async disconnect(connectionId: string): Promise<void> {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    if (entry.client) {
      try {
        await entry.client.shutdown();
      } catch {
        // Ignore shutdown errors
      }
    }

    this.connections.delete(connectionId);
  }

  /**
   * Disconnect from all hosts
   */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys());
    await Promise.allSettled(ids.map((id) => this.disconnect(id)));
  }

  /**
   * Get connection status
   */
  getStatus(connectionId: string): RemoteConnection | undefined {
    return this.connections.get(connectionId)?.connection;
  }

  /**
   * List all connections
   */
  listConnections(): RemoteConnection[] {
    return Array.from(this.connections.values()).map((e) => e.connection);
  }

  /**
   * Check if a connection exists and is ready
   */
  isReady(connectionId: string): boolean {
    const entry = this.connections.get(connectionId);
    return entry?.connection.status === "ready" && !!entry.client;
  }

  /**
   * Reconnect to a host
   */
  async reconnect(connectionId: string): Promise<void> {
    const entry = this.connections.get(connectionId);
    if (!entry) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    const host = entry.connection.host;
    await this.disconnect(connectionId);
    await this.connect(host);
  }

  /**
   * Get a ready connection or throw
   */
  private getReadyConnection(connectionId: string): ConnectionEntry {
    const entry = this.connections.get(connectionId);

    if (!entry) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    if (entry.connection.status !== "ready" || !entry.client) {
      throw new Error(
        `Connection not ready: ${connectionId} (status: ${entry.connection.status})`
      );
    }

    return entry;
  }

  /**
   * Generate connection ID from host config
   */
  private getConnectionId(host: RemoteHost): string {
    return host.id || `${host.username}@${host.hostname}:${host.port}`;
  }
}

/** Singleton connection manager instance */
export const connectionManager = new ConnectionManager();

/** Export class for testing or custom instances */
export { ConnectionManager };
