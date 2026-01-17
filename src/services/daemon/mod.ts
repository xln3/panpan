/**
 * Daemon module - background process for task execution and persistence.
 *
 * Provides:
 * - Background LLM task execution (survives session close)
 * - SQLite-backed storage for sessions and tasks
 * - IPC communication between client and daemon
 *
 * @example
 * ```typescript
 * import { getDaemonClient } from "./services/daemon/mod.ts";
 *
 * // Get a connected client (starts daemon if needed)
 * const client = await getDaemonClient();
 *
 * // Execute a prompt in the background
 * const status = await client.execute({
 *   prompt: "Analyze this codebase",
 *   model: "claude-haiku",
 *   projectRoot: "/my/project",
 * });
 *
 * // Stream output (can disconnect and reconnect)
 * for await (const chunk of client.streamOutput(status.taskId)) {
 *   console.log(chunk.content);
 * }
 * ```
 */

// Types
export type {
  DaemonConfig,
  ExecuteRequest,
  ExecutionStatus,
  IPCMessageType,
  IPCRequest,
  IPCResponse,
  OutputChunk,
  OutputChunkType,
  Session,
  SessionCreate,
  SessionStatus,
  SessionUpdate,
  Task,
  TaskCreate,
  TaskStatus,
  TaskUpdate,
} from "./types.ts";

export { DEFAULT_DAEMON_PORT, getDefaultDaemonPaths } from "./types.ts";

// Database
export { DaemonDatabase } from "./database.ts";

// IPC
export {
  ConnectionClosedError,
  createErrorResponse,
  createRequest,
  createSuccessResponse,
  decodeMessage,
  encodeMessage,
  MessageTooLargeError,
  readMessage,
  writeMessage,
} from "./ipc.ts";

// Server
export type { DaemonServerConfig } from "./server.ts";
export { DaemonServer } from "./server.ts";

// Client
export type { DaemonClientConfig, GetOutputResult } from "./client.ts";
export { DaemonClient, tryConnect } from "./client.ts";

// Executor
export { TaskExecutor } from "./executor.ts";

// Output buffer
export type { OutputSubscriber } from "./output-buffer.ts";
export { OutputBuffer, OutputBufferManager } from "./output-buffer.ts";

// Lifecycle
export type { LifecycleConfig } from "./lifecycle.ts";
export {
  DaemonLifecycle,
  getDaemonClient,
  getDaemonLifecycle,
  isDaemonRunning,
  startDaemon,
  stopDaemon,
} from "./lifecycle.ts";
