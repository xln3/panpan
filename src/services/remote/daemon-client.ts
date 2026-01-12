/**
 * HTTP client for communicating with the remote daemon.
 * Handles exec, file read/write, health check, and shutdown.
 */

import type { RemoteExecOutput } from "../../types/remote.ts";

/** Options for command execution */
export interface ExecOptions {
  /** Command to execute */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

/** Health check response */
export interface HealthResponse {
  status: string;
  pid: number;
  uptime: number;
}

/**
 * Client for communicating with panpan daemon over HTTP
 */
export class DaemonClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly hostname: string;

  constructor(hostname: string, port: number, token: string) {
    this.baseUrl = `http://${hostname}:${port}`;
    this.token = token;
    this.hostname = hostname;
  }

  /** Get the hostname this client is connected to */
  getHostname(): string {
    return this.hostname;
  }

  /**
   * Health check - verify daemon is responsive
   */
  async health(): Promise<HealthResponse> {
    const response = await this.request("/health", { method: "GET" });
    return response.json();
  }

  /**
   * Execute a command on the remote host
   */
  async exec(options: ExecOptions): Promise<RemoteExecOutput> {
    const startTime = Date.now();

    const response = await this.request("/exec", {
      method: "POST",
      body: JSON.stringify({
        command: options.command,
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout ?? 60000,
      }),
    });

    const result = await response.json();

    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? (result.error ? -1 : 0),
      durationMs: Date.now() - startTime,
      host: this.hostname, // Always include hostname to avoid confusion
    };
  }

  /**
   * Read a file from the remote host
   */
  async readFile(path: string): Promise<string> {
    const response = await this.request("/file/read", {
      method: "POST",
      body: JSON.stringify({ path }),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(`[${this.hostname}] ${result.error}`);
    }
    return result.content;
  }

  /**
   * Write content to a file on the remote host
   */
  async writeFile(path: string, content: string): Promise<void> {
    const response = await this.request("/file/write", {
      method: "POST",
      body: JSON.stringify({ path, content }),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(`[${this.hostname}] ${result.error}`);
    }
  }

  /**
   * Shutdown the daemon gracefully
   */
  async shutdown(): Promise<void> {
    try {
      await this.request("/shutdown", { method: "POST" });
    } catch {
      // Ignore errors during shutdown - connection may close before response
    }
  }

  /**
   * Check if daemon is reachable
   */
  async isAlive(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Internal request method with authentication
   */
  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `[${this.hostname}] Daemon error ${response.status}: ${text}`,
        );
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
