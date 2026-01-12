/**
 * Remote execution service module.
 *
 * Provides SSH bootstrap + HTTP daemon architecture for remote command execution.
 *
 * Main exports:
 * - `connectionManager` - Singleton for managing remote connections
 * - `DaemonClient` - HTTP client for daemon communication
 * - `bootstrapDaemon` - Low-level SSH bootstrap function
 *
 * @example
 * ```typescript
 * import { connectionManager } from "./services/remote/mod.ts";
 *
 * // Connect to remote host
 * const host = {
 *   id: "my-server",
 *   hostname: "192.168.1.100",
 *   port: 22,
 *   username: "deploy",
 *   authMethod: "key",
 *   keyPath: "~/.ssh/id_rsa",
 * };
 *
 * const connectionId = await connectionManager.connect(host);
 *
 * // Execute commands
 * const result = await connectionManager.execute(connectionId, {
 *   command: "nvidia-smi",
 * });
 * console.log(result.stdout); // Output includes host name
 *
 * // Cleanup
 * await connectionManager.disconnect(connectionId);
 * ```
 */

// Connection management
export { ConnectionManager, connectionManager } from "./connection-manager.ts";

// Daemon client
export {
  DaemonClient,
  type ExecOptions,
  type HealthResponse,
} from "./daemon-client.ts";

// SSH bootstrap
export {
  bootstrapDaemon,
  killRemoteDaemon,
  type SSHBootstrapOptions,
  type SSHBootstrapResult,
} from "./ssh-bootstrap.ts";

// Daemon binary
export { DAEMON_SOURCE, DAEMON_VERSION } from "./daemon-binary.ts";
