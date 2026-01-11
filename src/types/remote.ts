/**
 * Remote execution types for SSH-based operations.
 * Used by RemoteSA to manage connections and execute commands on remote hosts.
 */

/**
 * Remote host configuration
 */
export interface RemoteHost {
  /** Unique identifier for this host */
  id: string;
  /** Hostname or IP address */
  hostname: string;
  /** SSH port (default: 22) */
  port: number;
  /** SSH username */
  username: string;
  /** Authentication method */
  authMethod: "key" | "password" | "agent";
  /** Path to private key file (for key-based auth) */
  keyPath?: string;
  /** Host key fingerprint for verification */
  fingerprint?: string;
}

/**
 * State of a remote connection
 */
export interface RemoteConnection {
  /** The host configuration */
  host: RemoteHost;
  /** Current connection status */
  status: "connecting" | "bootstrapping" | "ready" | "error";
  /** Port the daemon is listening on */
  daemonPort?: number;
  /** Process ID of the remote daemon */
  daemonPid?: number;
  /** Unix timestamp when connection was established */
  connectedAt?: number;
  /** Unix timestamp of last activity */
  lastActivity?: number;
  /** Error message if status is "error" */
  error?: string;
}

/**
 * Information about the remote daemon process
 */
export interface DaemonInfo {
  /** Daemon version string */
  version: string;
  /** Process ID on the remote host */
  pid: number;
  /** Port the daemon is listening on */
  port: number;
  /** Unix timestamp when daemon started */
  startedAt: number;
  /** Capabilities supported by this daemon */
  capabilities: ("exec" | "file" | "watch")[];
}

/**
 * Input for remote command execution
 */
export interface RemoteExecInput {
  /** ID of the connection to use */
  connectionId: string;
  /** Command to execute */
  command: string;
  /** Working directory (default: home directory) */
  cwd?: string;
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Whether to stream output */
  stream?: boolean;
}

/**
 * Output from remote command execution
 */
export interface RemoteExecOutput {
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Exit code of the command */
  exitCode: number;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Hostname where command was executed (always included to avoid confusion) */
  host: string;
}

/**
 * Input for remote file operations
 */
export interface RemoteFileInput {
  /** ID of the connection to use */
  connectionId: string;
  /** Path on the remote host */
  path: string;
  /** Content to write (for write operations) */
  content?: string;
}
