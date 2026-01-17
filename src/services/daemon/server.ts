/**
 * Daemon server - handles IPC requests from clients.
 *
 * Cross-platform:
 * - Unix/macOS: Unix domain socket
 * - Windows: TCP on localhost
 */

import { ensureDir } from "@std/fs";
import { dirname } from "@std/path";
import { DaemonDatabase } from "./database.ts";
import { TaskExecutor } from "./executor.ts";
import {
  ConnectionClosedError,
  createErrorResponse,
  createSuccessResponse,
  readMessage,
  writeMessage,
} from "./ipc.ts";
import {
  DEFAULT_DAEMON_PORT,
  type ExecuteRequest,
  getDefaultDaemonPaths,
  type IPCRequest,
  type IPCResponse,
  type SessionCreate,
  type SessionUpdate,
  type TaskCreate,
  type TaskUpdate,
} from "./types.ts";

/** Server configuration */
export interface DaemonServerConfig {
  dbPath?: string;
  socketPath?: string;
  port?: number;
}

/**
 * Daemon server that listens for IPC connections.
 */
export class DaemonServer {
  private db: DaemonDatabase;
  private executor: TaskExecutor;
  private listener: Deno.Listener | null = null;
  private connections = new Set<Deno.Conn>();
  private running = false;
  private readonly socketPath: string;
  private readonly port: number;
  private cleanupInterval: number | null = null;

  constructor(config?: DaemonServerConfig) {
    const defaults = getDefaultDaemonPaths();
    const dbPath = config?.dbPath ?? defaults.dbPath;
    this.socketPath = config?.socketPath ?? defaults.socketPath;
    this.port = config?.port ?? DEFAULT_DAEMON_PORT;
    this.db = new DaemonDatabase(dbPath);
    this.executor = new TaskExecutor(this.db);
  }

  /** Start the daemon server */
  async start(): Promise<void> {
    if (this.running) return;

    // Open database
    await this.db.open();

    // Create listener based on platform
    if (Deno.build.os === "windows") {
      this.listener = Deno.listen({
        port: this.port,
        hostname: "127.0.0.1",
      });
    } else {
      // Unix socket
      await ensureDir(dirname(this.socketPath));

      // Remove stale socket if exists
      try {
        await Deno.remove(this.socketPath);
      } catch {
        // Ignore if doesn't exist
      }

      this.listener = Deno.listen({
        transport: "unix",
        path: this.socketPath,
      });
    }

    this.running = true;
    this.acceptConnections();

    // Start cleanup interval (every 5 minutes)
    this.cleanupInterval = setInterval(() => {
      this.executor.cleanup();
    }, 5 * 60 * 1000);
  }

  /** Stop the daemon server */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all connections
    for (const conn of this.connections) {
      try {
        conn.close();
      } catch {
        // Ignore close errors
      }
    }
    this.connections.clear();

    // Close listener
    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }

    // Close database
    this.db.close();

    // Clean up socket file
    if (Deno.build.os !== "windows") {
      try {
        await Deno.remove(this.socketPath);
      } catch {
        // Ignore
      }
    }
  }

  /** Check if server is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Get the database instance */
  getDatabase(): DaemonDatabase {
    return this.db;
  }

  private async acceptConnections(): Promise<void> {
    if (!this.listener) return;

    while (this.running) {
      try {
        const conn = await this.listener.accept();
        this.connections.add(conn);
        this.handleConnection(conn);
      } catch (error) {
        if (this.running) {
          console.error("[daemon] Accept error:", error);
        }
        // If not running, accept() threw because listener was closed
      }
    }
  }

  private async handleConnection(conn: Deno.Conn): Promise<void> {
    try {
      while (this.running) {
        const request = await readMessage<IPCRequest>(conn);
        if (request === null) break; // Connection closed

        const response = await this.handleRequest(request);
        await writeMessage(conn, response);
      }
    } catch (error) {
      // Suppress expected errors when connections close
      const isExpectedError = error instanceof ConnectionClosedError ||
        (error instanceof Error && error.name === "Interrupted");
      if (!isExpectedError && this.running) {
        console.error("[daemon] Connection error:", error);
      }
    } finally {
      this.connections.delete(conn);
      try {
        conn.close();
      } catch {
        // Ignore
      }
    }
  }

  private async handleRequest(request: IPCRequest): Promise<IPCResponse> {
    try {
      switch (request.type) {
        case "ping":
          return createSuccessResponse(request.id, { pong: true });

        case "shutdown":
          // Schedule shutdown after response is sent
          setTimeout(() => this.stop(), 100);
          return createSuccessResponse(request.id, { shutting_down: true });

        // Session operations
        case "session_create": {
          const payload = request.payload as SessionCreate;
          const session = this.db.createSession(payload);
          return createSuccessResponse(request.id, session);
        }

        case "session_get": {
          const { id } = request.payload as { id: string };
          const session = this.db.getSession(id);
          if (!session) {
            return createErrorResponse(request.id, "Session not found");
          }
          return createSuccessResponse(request.id, session);
        }

        case "session_list": {
          const options = request.payload as {
            status?: string;
            projectRoot?: string;
            limit?: number;
            offset?: number;
          } | undefined;
          const sessions = this.db.listSessions(options);
          return createSuccessResponse(request.id, sessions);
        }

        case "session_update": {
          const { id, ...update } = request.payload as
            & { id: string }
            & SessionUpdate;
          const session = this.db.updateSession(id, update);
          if (!session) {
            return createErrorResponse(request.id, "Session not found");
          }
          return createSuccessResponse(request.id, session);
        }

        // Task operations
        case "task_create": {
          const payload = request.payload as TaskCreate;
          const task = this.db.createTask(payload);
          return createSuccessResponse(request.id, task);
        }

        case "task_get": {
          const { id } = request.payload as { id: string };
          const task = this.db.getTask(id);
          if (!task) {
            return createErrorResponse(request.id, "Task not found");
          }
          return createSuccessResponse(request.id, task);
        }

        case "task_list": {
          const options = request.payload as {
            sessionId?: string;
            status?: string;
            limit?: number;
            offset?: number;
          } | undefined;
          const tasks = this.db.listTasks(options);
          return createSuccessResponse(request.id, tasks);
        }

        case "task_update": {
          const { id, ...update } = request.payload as { id: string } & TaskUpdate;
          const task = this.db.updateTask(id, update);
          if (!task) {
            return createErrorResponse(request.id, "Task not found");
          }
          return createSuccessResponse(request.id, task);
        }

        // Execution operations
        case "execute": {
          const payload = request.payload as ExecuteRequest;
          const status = await this.executor.execute(payload);
          return createSuccessResponse(request.id, status);
        }

        case "get_status": {
          const { taskId } = request.payload as { taskId: string };
          const status = this.executor.getStatus(taskId);
          if (!status) {
            return createErrorResponse(request.id, "Task not found");
          }
          return createSuccessResponse(request.id, status);
        }

        case "get_output": {
          const { taskId, fromId } = request.payload as {
            taskId: string;
            fromId?: number;
          };
          const buffer = this.executor.getBuffer(taskId);
          if (!buffer) {
            // Task completed or not found - check database
            const task = this.db.getTask(taskId);
            if (!task) {
              return createErrorResponse(request.id, "Task not found");
            }
            // Return empty chunks for completed task with no buffer
            return createSuccessResponse(request.id, {
              chunks: [],
              hasMore: false,
              status: task.status,
            });
          }

          const chunks = buffer.getChunks(fromId);
          const status = this.executor.getStatus(taskId);

          return createSuccessResponse(request.id, {
            chunks,
            hasMore: status?.status === "running",
            status: status?.status ?? "completed",
          });
        }

        case "cancel": {
          const { taskId } = request.payload as { taskId: string };
          const cancelled = this.executor.cancel(taskId);
          if (!cancelled) {
            return createErrorResponse(request.id, "Task not found or not running");
          }
          return createSuccessResponse(request.id, { cancelled: true });
        }

        case "attach":
        case "detach":
          // These are handled via get_output polling
          return createSuccessResponse(request.id, { ok: true });

        default:
          return createErrorResponse(
            request.id,
            `Unknown request type: ${request.type}`,
          );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createErrorResponse(request.id, message);
    }
  }
}

// If run directly, start the server
if (import.meta.main) {
  const server = new DaemonServer();
  await server.start();

  console.log("[daemon] Server started");

  // Handle signals for graceful shutdown
  const shutdown = async () => {
    console.log("[daemon] Shutting down...");
    await server.stop();
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}
