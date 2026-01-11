/**
 * Remote tools module - LLM-callable tools for remote server operations
 *
 * Provides tools for:
 * - RemoteConnect: Establish SSH connection
 * - RemoteExec: Execute commands
 * - RemoteFileRead: Read files
 * - RemoteFileWrite: Write files
 * - RemoteDisconnect: Close connection
 * - RemoteList: List connections
 *
 * @example
 * ```typescript
 * // Connect to server
 * RemoteConnect({ hostname: "server.example.com", username: "deploy" })
 * // -> connectionId: "deploy@server.example.com:22"
 *
 * // Execute command
 * RemoteExec({ connection_id: "deploy@...", command: "nvidia-smi" })
 * // -> stdout with GPU info
 *
 * // Disconnect
 * RemoteDisconnect({ connection_id: "deploy@..." })
 * ```
 */

export { RemoteConnectTool } from "./remote-connect.ts";
export { RemoteExecTool } from "./remote-exec.ts";
export { RemoteFileReadTool, RemoteFileWriteTool } from "./remote-file.ts";
export { RemoteDisconnectTool, RemoteListTool } from "./remote-disconnect.ts";
