/**
 * Daemon IPC client - connects to the daemon server.
 *
 * Provides high-level API for session and task management.
 */

import {
  createRequest,
  readMessage,
  writeMessage,
} from "./ipc.ts";
import {
  DEFAULT_DAEMON_PORT,
  type ExecuteRequest,
  type ExecutionStatus,
  getDefaultDaemonPaths,
  type IPCResponse,
  type OutputChunk,
  type Session,
  type SessionCreate,
  type SessionUpdate,
  type Task,
  type TaskCreate,
  type TaskStatus,
  type TaskUpdate,
} from "./types.ts";

/** Result of getOutput call */
export interface GetOutputResult {
  chunks: OutputChunk[];
  hasMore: boolean;
  status: TaskStatus;
}

/** Client configuration */
export interface DaemonClientConfig {
  socketPath?: string;
  port?: number;
  timeout?: number;
}

/** Default request timeout (10 seconds) */
const DEFAULT_TIMEOUT = 10000;

/**
 * Client for communicating with the daemon server.
 */
export class DaemonClient {
  private conn: Deno.Conn | null = null;
  private readonly socketPath: string;
  private readonly port: number;
  private readonly timeout: number;

  constructor(config?: DaemonClientConfig) {
    const defaults = getDefaultDaemonPaths();
    this.socketPath = config?.socketPath ?? defaults.socketPath;
    this.port = config?.port ?? DEFAULT_DAEMON_PORT;
    this.timeout = config?.timeout ?? DEFAULT_TIMEOUT;
  }

  /** Connect to the daemon server */
  async connect(): Promise<void> {
    if (this.conn) return;

    if (Deno.build.os === "windows") {
      this.conn = await Deno.connect({
        port: this.port,
        hostname: "127.0.0.1",
      });
    } else {
      this.conn = await Deno.connect({
        transport: "unix",
        path: this.socketPath,
      });
    }
  }

  /** Disconnect from the daemon server */
  disconnect(): void {
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        // Ignore close errors
      }
      this.conn = null;
    }
  }

  /** Check if connected */
  isConnected(): boolean {
    return this.conn !== null;
  }

  /** Send a request and wait for response */
  private async request<T>(
    type: string,
    payload?: unknown,
  ): Promise<T> {
    if (!this.conn) {
      throw new Error("Not connected to daemon");
    }

    const request = createRequest(type as never, payload);

    // Send request
    await writeMessage(this.conn, request);

    // Wait for response with timeout (using AbortController pattern to clean up timer)
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Request timeout")),
        this.timeout,
      );
    });

    try {
      const response = await Promise.race([
        readMessage<IPCResponse>(this.conn),
        timeoutPromise,
      ]);

      if (response === null) {
        throw new Error("Connection closed");
      }

      if (!response.success) {
        throw new Error(response.error ?? "Unknown error");
      }

      return response.data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ===========================================================================
  // High-level API
  // ===========================================================================

  /** Ping the daemon */
  async ping(): Promise<{ pong: boolean }> {
    return await this.request("ping");
  }

  /** Request daemon shutdown */
  async shutdown(): Promise<void> {
    await this.request("shutdown");
    this.disconnect();
  }

  // Session operations

  /** Create a new session */
  async createSession(input: SessionCreate): Promise<Session> {
    return await this.request("session_create", input);
  }

  /** Get a session by ID */
  async getSession(id: string): Promise<Session> {
    return await this.request("session_get", { id });
  }

  /** List sessions */
  async listSessions(options?: {
    status?: string;
    projectRoot?: string;
    limit?: number;
    offset?: number;
  }): Promise<Session[]> {
    return await this.request("session_list", options);
  }

  /** Update a session */
  async updateSession(id: string, update: SessionUpdate): Promise<Session> {
    return await this.request("session_update", { id, ...update });
  }

  // Task operations

  /** Create a new task */
  async createTask(input: TaskCreate): Promise<Task> {
    return await this.request("task_create", input);
  }

  /** Get a task by ID */
  async getTask(id: string): Promise<Task> {
    return await this.request("task_get", { id });
  }

  /** List tasks */
  async listTasks(options?: {
    sessionId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<Task[]> {
    return await this.request("task_list", options);
  }

  /** Update a task */
  async updateTask(id: string, update: TaskUpdate): Promise<Task> {
    return await this.request("task_update", { id, ...update });
  }

  // ===========================================================================
  // Execution API
  // ===========================================================================

  /**
   * Execute a prompt in the daemon.
   * Returns immediately with execution status; task runs in background.
   */
  async execute(request: ExecuteRequest): Promise<ExecutionStatus> {
    return await this.request("execute", request);
  }

  /**
   * Get execution status.
   */
  async getStatus(taskId: string): Promise<ExecutionStatus> {
    return await this.request("get_status", { taskId });
  }

  /**
   * Get output chunks from a running or completed task.
   * Use fromId to get chunks after a specific point (for pagination/streaming).
   */
  async getOutput(taskId: string, fromId?: number): Promise<GetOutputResult> {
    return await this.request("get_output", { taskId, fromId });
  }

  /**
   * Cancel a running task.
   */
  async cancel(taskId: string): Promise<{ cancelled: boolean }> {
    return await this.request("cancel", { taskId });
  }

  /**
   * Stream output from a task.
   * Yields chunks as they become available.
   */
  async *streamOutput(
    taskId: string,
    pollIntervalMs = 100,
  ): AsyncGenerator<OutputChunk> {
    let lastId = -1;

    while (true) {
      const result = await this.getOutput(taskId, lastId + 1);

      for (const chunk of result.chunks) {
        yield chunk;
        lastId = chunk.id;
      }

      if (!result.hasMore) {
        break;
      }

      // Wait before next poll
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }
}

/**
 * Try to connect to the daemon.
 * Returns a connected client if successful, null if daemon is not running.
 */
export async function tryConnect(
  config?: DaemonClientConfig,
): Promise<DaemonClient | null> {
  const client = new DaemonClient(config);
  try {
    await client.connect();
    // Verify connection with ping
    await client.ping();
    return client;
  } catch {
    client.disconnect();
    return null;
  }
}
