/**
 * Daemon lifecycle management - start/stop/status.
 *
 * Handles spawning and monitoring the daemon process.
 */

import { DaemonClient, tryConnect } from "./client.ts";
import {
  DEFAULT_DAEMON_PORT,
  getDefaultDaemonPaths,
} from "./types.ts";

/** Lifecycle configuration */
export interface LifecycleConfig {
  socketPath?: string;
  port?: number;
  /** Maximum time to wait for daemon to start (ms) */
  startTimeout?: number;
  /** Retry interval when checking if daemon is ready (ms) */
  retryInterval?: number;
}

/** Default start timeout (5 seconds) */
const DEFAULT_START_TIMEOUT = 5000;

/** Default retry interval (100 ms) */
const DEFAULT_RETRY_INTERVAL = 100;

/**
 * Manages daemon lifecycle - starting, stopping, and checking status.
 */
export class DaemonLifecycle {
  private readonly socketPath: string;
  private readonly port: number;
  private readonly startTimeout: number;
  private readonly retryInterval: number;

  constructor(config?: LifecycleConfig) {
    const defaults = getDefaultDaemonPaths();
    this.socketPath = config?.socketPath ?? defaults.socketPath;
    this.port = config?.port ?? DEFAULT_DAEMON_PORT;
    this.startTimeout = config?.startTimeout ?? DEFAULT_START_TIMEOUT;
    this.retryInterval = config?.retryInterval ?? DEFAULT_RETRY_INTERVAL;
  }

  /**
   * Check if the daemon is running.
   */
  async isRunning(): Promise<boolean> {
    const client = await tryConnect({
      socketPath: this.socketPath,
      port: this.port,
    });

    if (client) {
      client.disconnect();
      return true;
    }

    return false;
  }

  /**
   * Get a connected client if daemon is running.
   */
  async getClient(): Promise<DaemonClient | null> {
    return await tryConnect({
      socketPath: this.socketPath,
      port: this.port,
    });
  }

  /**
   * Start the daemon process.
   * If already running, returns immediately.
   */
  async start(): Promise<void> {
    // Check if already running
    if (await this.isRunning()) {
      return;
    }

    // Find the server entry point
    const serverPath = this.findServerPath();

    // Spawn daemon process
    const cmd = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        serverPath,
      ],
      stdin: "null",
      stdout: "null",
      stderr: "null",
      env: {
        ...Deno.env.toObject(),
        PANPAN_DAEMON_SOCKET: this.socketPath,
        PANPAN_DAEMON_PORT: this.port.toString(),
      },
    });

    const process = cmd.spawn();
    process.unref();

    // Wait for daemon to be ready
    const startTime = Date.now();
    while (Date.now() - startTime < this.startTimeout) {
      if (await this.isRunning()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.retryInterval));
    }

    throw new Error("Failed to start daemon: timeout waiting for ready");
  }

  /**
   * Stop the daemon process.
   */
  async stop(): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      return; // Not running
    }

    try {
      await client.shutdown();
    } catch {
      // Ignore errors - daemon may have already shut down
    } finally {
      client.disconnect();
    }
  }

  /**
   * Restart the daemon process.
   */
  async restart(): Promise<void> {
    await this.stop();
    // Small delay to ensure cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));
    await this.start();
  }

  /**
   * Ensure daemon is running, starting if necessary.
   * Returns a connected client.
   */
  async ensureRunning(): Promise<DaemonClient> {
    let client = await this.getClient();
    if (client) {
      return client;
    }

    await this.start();

    client = await this.getClient();
    if (!client) {
      throw new Error("Failed to connect to daemon after starting");
    }

    return client;
  }

  private findServerPath(): string {
    // Try to find the server module relative to this file
    const thisFile = import.meta.url;

    // Convert file:// URL to path
    let basePath: string;
    if (thisFile.startsWith("file://")) {
      basePath = thisFile.slice(7);
      // Handle Windows paths
      if (Deno.build.os === "windows" && basePath.startsWith("/")) {
        basePath = basePath.slice(1);
      }
    } else {
      basePath = thisFile;
    }

    // Navigate to server.ts
    const serverPath = basePath.replace(/lifecycle\.ts$/, "server.ts");

    return serverPath;
  }
}

/** Global lifecycle instance */
let globalLifecycle: DaemonLifecycle | null = null;

/**
 * Get the global daemon lifecycle instance.
 */
export function getDaemonLifecycle(): DaemonLifecycle {
  if (!globalLifecycle) {
    globalLifecycle = new DaemonLifecycle();
  }
  return globalLifecycle;
}

/**
 * Check if daemon is running (convenience function).
 */
export async function isDaemonRunning(): Promise<boolean> {
  return await getDaemonLifecycle().isRunning();
}

/**
 * Start daemon if not running (convenience function).
 */
export async function startDaemon(): Promise<void> {
  await getDaemonLifecycle().start();
}

/**
 * Stop daemon (convenience function).
 */
export async function stopDaemon(): Promise<void> {
  await getDaemonLifecycle().stop();
}

/**
 * Get a connected client, starting daemon if needed (convenience function).
 */
export async function getDaemonClient(): Promise<DaemonClient> {
  return await getDaemonLifecycle().ensureRunning();
}
