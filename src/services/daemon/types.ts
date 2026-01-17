/**
 * Type definitions for the daemon system.
 *
 * Defines session/task states, IPC message format, and database records.
 */

// =============================================================================
// Session Types
// =============================================================================

/** Session status - tracks the lifecycle of an interactive session */
export type SessionStatus = "active" | "completed" | "failed" | "cancelled";

/** Session record stored in the database */
export interface Session {
  id: string;
  projectRoot: string;
  model: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

/** Input for creating a new session */
export interface SessionCreate {
  projectRoot: string;
  model: string;
  metadata?: Record<string, unknown>;
}

/** Input for updating an existing session */
export interface SessionUpdate {
  status?: SessionStatus;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Task Types
// =============================================================================

/** Task status - tracks individual work items within a session */
export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Task record stored in the database */
export interface Task {
  id: string;
  sessionId: string;
  type: string;
  description: string;
  status: TaskStatus;
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

/** Input for creating a new task */
export interface TaskCreate {
  sessionId: string;
  type: string;
  description: string;
}

/** Input for updating an existing task */
export interface TaskUpdate {
  status?: TaskStatus;
  result?: string;
  error?: string;
  completedAt?: number;
}

// =============================================================================
// Execution Types
// =============================================================================

/** Output chunk types for streaming */
export type OutputChunkType =
  | "text" // Assistant text response
  | "thinking" // Model thinking (Claude)
  | "tool_use" // Tool being called
  | "tool_result" // Tool execution result
  | "error" // Error message
  | "status"; // Status update (started, completed, etc.)

/** A single chunk of output from task execution */
export interface OutputChunk {
  id: number;
  timestamp: number;
  type: OutputChunkType;
  content: string;
  metadata?: Record<string, unknown>;
}

/** Request to execute a prompt in the daemon */
export interface ExecuteRequest {
  /** The user prompt to execute */
  prompt: string;
  /** Session ID (creates new if not provided) */
  sessionId?: string;
  /** Model to use */
  model: string;
  /** Project root directory */
  projectRoot: string;
  /** System prompt additions */
  systemPrompt?: string[];
  /** LLM config overrides */
  llmConfig?: {
    baseUrl?: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

/** Status of an executing task */
export interface ExecutionStatus {
  taskId: string;
  sessionId: string;
  status: TaskStatus;
  outputCount: number;
  startedAt: number;
  completedAt?: number;
}

// =============================================================================
// IPC Types
// =============================================================================

/** All supported IPC message types */
export type IPCMessageType =
  | "ping"
  | "shutdown"
  // Session management
  | "session_create"
  | "session_get"
  | "session_list"
  | "session_update"
  // Task management
  | "task_create"
  | "task_get"
  | "task_list"
  | "task_update"
  // Execution (new)
  | "execute" // Start executing a prompt
  | "attach" // Attach to a running task's output stream
  | "detach" // Detach from output stream
  | "get_output" // Get buffered output chunks
  | "get_status" // Get execution status
  | "cancel"; // Cancel a running task

/** IPC request sent from client to server */
export interface IPCRequest {
  id: string;
  type: IPCMessageType;
  payload?: unknown;
}

/** IPC response sent from server to client */
export interface IPCResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// =============================================================================
// Daemon Configuration
// =============================================================================

/** Daemon configuration options */
export interface DaemonConfig {
  /** Path to the daemon database */
  dbPath: string;
  /** Unix socket path (Unix/macOS) */
  socketPath: string;
  /** TCP port for Windows */
  port: number;
}

/** Default daemon port for Windows */
export const DEFAULT_DAEMON_PORT = 19527;

/** Get default daemon paths */
export function getDefaultDaemonPaths(): {
  dbPath: string;
  socketPath: string;
} {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
  const panpanDir = `${home}/.panpan`;
  return {
    dbPath: `${panpanDir}/daemon.db`,
    socketPath: `${panpanDir}/daemon.sock`,
  };
}
