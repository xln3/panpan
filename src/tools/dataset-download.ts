/**
 * Dataset Download Tool
 * Handles large file downloads (datasets, model weights, etc.) with
 * pre-flight checks, user consent flow, and flexible execution options.
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";
import type { CommandResult } from "./package-managers/common.ts";
import { executeCommandStreaming } from "./package-managers/common.ts";

/**
 * Download necessity levels
 */
const necessityLevel = z.enum([
  "required", // Won't work without it
  "recommended", // Needed for full functionality
  "optional", // Nice to have, not strictly needed
]);

/**
 * Execution method for downloads
 */
const executionMethod = z.enum([
  "foreground", // Stream progress, blocking
  "nohup", // Background with nohup
  "tmux", // Background in tmux session
  "screen", // Background in screen session
  "manual", // Output command for user to run
]);

const prepareInputSchema = z.object({
  operation: z.literal("prepare"),
  url: z.string().url().describe("URL of the file to download"),
  destination: z.string().describe("Destination path for the download"),
});

const downloadInputSchema = z.object({
  operation: z.literal("download"),
  url: z.string().url().describe("URL of the file to download"),
  destination: z.string().describe("Destination path for the download"),
  method: executionMethod.describe("How to execute the download"),
  necessity: necessityLevel.describe("Why this download is needed"),
  necessity_detail: z.string().optional().describe(
    "Additional explanation for why this is needed",
  ),
  session_name: z.string().optional().describe(
    "Session name for tmux/screen (default: panpan-download)",
  ),
  resume: z.boolean().optional().describe(
    "Resume partial download if supported (default: true)",
  ),
});

const inputSchema = z.discriminatedUnion("operation", [
  prepareInputSchema,
  downloadInputSchema,
]);

type Input = z.infer<typeof inputSchema>;

interface NetworkError {
  message: string;
  type:
    | "timeout"
    | "connection_refused"
    | "dns"
    | "ssl"
    | "http_error"
    | "unknown";
  httpStatus?: number;
  hints: string[];
}

interface PrepareOutput {
  operation: "prepare";
  url: string;
  destination: string;
  // Size info
  file_size_bytes: number | null;
  file_size_human: string;
  content_type: string | null;
  supports_resume: boolean;
  // Disk info
  available_space_bytes: number;
  available_space_human: string;
  destination_exists: boolean;
  // Analysis
  sufficient_space: boolean;
  estimated_time_seconds: number | null;
  estimated_time_human: string;
  // Pre-flight errors
  error?: string;
  network_error?: NetworkError;
}

interface DownloadOutput {
  operation: "download";
  method: string;
  url: string;
  destination: string;
  // Necessity info
  necessity?: string;
  necessity_detail?: string;
  // For manual mode
  command?: string;
  instructions?: string;
  // For background modes
  session_name?: string;
  check_command?: string;
  // For foreground mode
  exit_code?: number;
  duration_ms?: number;
  success?: boolean;
  error?: string;
}

type Output = PrepareOutput | DownloadOutput;

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format seconds to human-readable duration
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours} hours`;
}

/**
 * Estimate download time based on typical network speeds
 * Returns estimates for different connection types
 */
function estimateDownloadTime(
  bytes: number,
): { seconds: number; description: string } {
  // Assume moderate connection: 10 MB/s (80 Mbps)
  // This is conservative for data centers, optimistic for home connections
  const ESTIMATED_SPEED_BYTES_PER_SEC = 10 * 1024 * 1024; // 10 MB/s
  const seconds = bytes / ESTIMATED_SPEED_BYTES_PER_SEC;

  // Add description noting this is an estimate
  let description = formatDuration(seconds);
  if (bytes > 1024 * 1024 * 1024) { // > 1GB
    description += " (at ~10 MB/s, actual time depends on network)";
  }

  return { seconds, description };
}

/**
 * Classify network error and generate troubleshooting hints
 */
function classifyNetworkError(
  error: string,
  url: string,
  httpStatus?: number,
): NetworkError {
  const errorLower = error.toLowerCase();
  const urlObj = new URL(url);
  const host = urlObj.hostname;

  // Timeout errors
  if (errorLower.includes("timed out") || errorLower.includes("timeout")) {
    return {
      message: error,
      type: "timeout",
      hints: [
        "The connection timed out. Possible causes:",
        "  • Server is slow or overloaded",
        "  • Network firewall blocking the connection",
        "  • You may need a proxy to access this host",
        "",
        "Try:",
        `  • Check if you can reach ${host} in a browser`,
        "  • Set proxy: export https_proxy=http://your-proxy:port",
        "  • Use a VPN if the host is geo-restricted",
        `  • Try a mirror if available (search: "${host} mirror")`,
      ],
    };
  }

  // Connection refused
  if (
    errorLower.includes("connection refused") ||
    errorLower.includes("econnrefused")
  ) {
    return {
      message: error,
      type: "connection_refused",
      hints: [
        "Connection was refused by the server.",
        "",
        "Try:",
        "  • The server may be down - try again later",
        `  • Check if ${host} is accessible from your network`,
        "  • The port may be blocked by firewall",
      ],
    };
  }

  // DNS errors
  if (
    errorLower.includes("dns") || errorLower.includes("getaddrinfo") ||
    errorLower.includes("enotfound") ||
    errorLower.includes("name or service not known")
  ) {
    return {
      message: error,
      type: "dns",
      hints: [
        `DNS lookup failed for ${host}`,
        "",
        "Try:",
        "  • Check your internet connection",
        "  • Try a different DNS server: export DNS_SERVER=8.8.8.8",
        `  • Verify the hostname is correct: nslookup ${host}`,
        "  • Add to /etc/hosts if you know the IP address",
      ],
    };
  }

  // SSL/TLS errors
  if (
    errorLower.includes("ssl") || errorLower.includes("tls") ||
    errorLower.includes("certificate") || errorLower.includes("handshake")
  ) {
    return {
      message: error,
      type: "ssl",
      hints: [
        "SSL/TLS connection failed.",
        "",
        "Possible causes:",
        "  • Certificate verification failed (self-signed or expired cert)",
        "  • TLS version mismatch",
        "  • Proxy intercepting HTTPS traffic",
        "",
        "Try:",
        "  • If using a corporate proxy, ensure its CA cert is installed",
        "  • For testing only: wget --no-check-certificate (not recommended)",
      ],
    };
  }

  // Broken pipe / connection reset
  if (
    errorLower.includes("broken pipe") ||
    errorLower.includes("connection reset") ||
    errorLower.includes("econnreset")
  ) {
    return {
      message: error,
      type: "connection_refused",
      hints: [
        "Connection was reset or broken.",
        "",
        "Possible causes:",
        "  • Server closed the connection unexpectedly",
        "  • Network instability",
        "  • Firewall or proxy terminating the connection",
        "",
        "Try:",
        "  • Retry the download - this may be transient",
        "  • Check if a proxy is required for this host",
        "  • Try downloading at a different time (server may be overloaded)",
      ],
    };
  }

  // HTTP errors
  if (httpStatus) {
    const hints: string[] = [];
    if (httpStatus === 403) {
      hints.push(
        "Access forbidden (HTTP 403).",
        "",
        "Possible causes:",
        "  • Authentication required",
        "  • IP-based access restrictions",
        "  • Rate limiting",
        "",
        "Try:",
        "  • Check if you need to log in or get an API token",
        "  • Use a different network/VPN",
        `  • Search for alternative download sources for this file`,
      );
    } else if (httpStatus === 404) {
      hints.push(
        "File not found (HTTP 404).",
        "",
        "Try:",
        "  • Verify the URL is correct",
        "  • The file may have been moved or deleted",
        "  • Check for an updated URL on the source website",
      );
    } else if (httpStatus >= 500) {
      hints.push(
        `Server error (HTTP ${httpStatus}).`,
        "",
        "The server is experiencing issues.",
        "",
        "Try:",
        "  • Wait and retry later",
        "  • Check the service status page if available",
        "  • Try a mirror if available",
      );
    } else {
      hints.push(
        `HTTP error ${httpStatus}`,
        "",
        "Try:",
        "  • Check if the URL requires authentication",
        "  • Verify the URL is accessible in a browser",
      );
    }
    return {
      message: error,
      type: "http_error",
      httpStatus,
      hints,
    };
  }

  // Unknown error - provide general hints
  return {
    message: error,
    type: "unknown",
    hints: [
      `Network error: ${error}`,
      "",
      "General troubleshooting:",
      "  • Check your internet connection",
      "  • Check if proxy is needed: export https_proxy=http://proxy:port",
      `  • Try accessing ${host} in a browser`,
      "  • Check firewall settings",
      "",
      "Manual download:",
      `  • Open ${url} in a browser`,
      "  • Use a download manager with better error handling",
    ],
  };
}

/**
 * Get file info via HTTP HEAD request
 */
async function getRemoteFileInfo(url: string, signal: AbortSignal): Promise<{
  size: number | null;
  contentType: string | null;
  supportsResume: boolean;
  error?: string;
  networkError?: NetworkError;
}> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal,
      redirect: "follow",
    });

    if (!response.ok) {
      const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      return {
        size: null,
        contentType: null,
        supportsResume: false,
        error: errorMsg,
        networkError: classifyNetworkError(errorMsg, url, response.status),
      };
    }

    const contentLength = response.headers.get("content-length");
    const contentType = response.headers.get("content-type");
    const acceptRanges = response.headers.get("accept-ranges");

    return {
      size: contentLength ? parseInt(contentLength, 10) : null,
      contentType,
      supportsResume: acceptRanges === "bytes",
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      size: null,
      contentType: null,
      supportsResume: false,
      error: errorMsg,
      networkError: classifyNetworkError(errorMsg, url),
    };
  }
}

/**
 * Get available disk space at destination path
 */
async function getDiskSpace(path: string): Promise<{
  available: number;
  error?: string;
}> {
  try {
    // Get the parent directory if path doesn't exist
    let checkPath = path;
    try {
      const stat = await Deno.stat(path);
      if (!stat.isDirectory) {
        // If it's a file, check parent directory
        checkPath = path.substring(0, path.lastIndexOf("/")) || "/";
      }
    } catch {
      // Path doesn't exist, find nearest existing parent
      const parts = path.split("/");
      while (parts.length > 1) {
        parts.pop();
        const parentPath = parts.join("/") || "/";
        try {
          await Deno.stat(parentPath);
          checkPath = parentPath;
          break;
        } catch {
          continue;
        }
      }
    }

    // Use df command to get available space (more reliable than statfs)
    const cmd = new Deno.Command("df", {
      args: ["-B1", checkPath], // -B1 for bytes
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, success } = await cmd.output();

    if (!success) {
      throw new Error("df command failed");
    }

    const output = new TextDecoder().decode(stdout);
    const lines = output.trim().split("\n");
    if (lines.length < 2) {
      throw new Error("Unexpected df output");
    }

    // Parse df output: Filesystem 1B-blocks Used Available Use% Mounted
    const parts = lines[1].split(/\s+/);
    const available = parseInt(parts[3], 10);

    return { available };
  } catch (err) {
    return {
      available: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check if destination already exists
 */
async function checkDestination(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build download command based on method
 *
 * Note on wget -c with -O: This combination works but has quirks.
 * If the server doesn't support resume (no Accept-Ranges), wget will
 * re-download and APPEND to existing file, corrupting it.
 * We only use -c when we know resume is safe (checked in prepare).
 */
function buildDownloadCommand(
  url: string,
  destination: string,
  resume: boolean,
  destinationExists: boolean,
): string[] {
  const args = ["wget"];

  // Only use -c if:
  // 1. Resume is requested
  // 2. Destination file already exists (partial download)
  // If file doesn't exist, -c is unnecessary
  if (resume && destinationExists) {
    args.push("-c");
  }

  args.push(
    "--progress=dot:giga", // Progress indicator for large files
    "-O",
    destination,
    url,
  );

  return args;
}

/**
 * Build command string for display
 */
function buildCommandString(
  url: string,
  destination: string,
  resume: boolean,
  destinationExists: boolean,
): string {
  const resumeFlag = (resume && destinationExists) ? "-c " : "";
  return `wget ${resumeFlag}--progress=dot:giga -O "${destination}" "${url}"`;
}

/**
 * Render output for assistant consumption
 */
function renderOutput(output: Output): string {
  if (output.operation === "prepare") {
    const lines: string[] = [
      "Download Preparation Results:",
      `  URL: ${output.url}`,
      `  Destination: ${output.destination}`,
      "",
      "File Info:",
      `  Size: ${output.file_size_human}${
        output.file_size_bytes !== null
          ? ` (${output.file_size_bytes} bytes)`
          : ""
      }`,
      `  Type: ${output.content_type || "unknown"}`,
      `  Resume supported: ${output.supports_resume ? "yes" : "no"}`,
      "",
      "Disk Space:",
      `  Available: ${output.available_space_human}`,
      `  Sufficient: ${
        output.sufficient_space ? "YES" : "NO - WILL FILL DISK"
      }`,
      `  Destination exists: ${
        output.destination_exists ? "yes (will overwrite)" : "no"
      }`,
      "",
      `Estimated time: ${output.estimated_time_human}`,
    ];

    if (output.network_error) {
      lines.push(
        "",
        "⚠️  NETWORK ERROR:",
        ...output.network_error.hints,
      );
    } else if (output.error) {
      lines.push("", `Warning: ${output.error}`);
    }

    if (!output.sufficient_space) {
      lines.push(
        "",
        "⚠️  INSUFFICIENT DISK SPACE - Do not proceed without freeing space!",
      );
    }

    return lines.join("\n");
  }

  // Download output
  const lines: string[] = [
    `Download (${output.method}):`,
    `  URL: ${output.url}`,
    `  Destination: ${output.destination}`,
  ];

  // Show necessity if provided
  if (output.necessity) {
    const necessityLabels: Record<string, string> = {
      required: "REQUIRED - needed for reproduction",
      recommended: "RECOMMENDED - needed for full functionality",
      optional: "OPTIONAL - not strictly needed",
    };
    lines.push(
      `  Necessity: ${necessityLabels[output.necessity] || output.necessity}`,
    );
    if (output.necessity_detail) {
      lines.push(`  Reason: ${output.necessity_detail}`);
    }
  }

  if (output.command) {
    lines.push("", `Command: ${output.command}`);
  }

  if (output.instructions) {
    lines.push("", output.instructions);
  }

  if (output.session_name && output.method !== "nohup") {
    lines.push("", `Session: ${output.session_name}`);
  }

  if (output.check_command) {
    lines.push("", "To check/monitor:", output.check_command);
  }

  if (output.success !== undefined) {
    lines.push(
      "",
      output.success ? "✓ Download started successfully" : "✗ Download failed",
    );
  }

  if (output.error) {
    lines.push("", `Error: ${output.error}`);
  }

  if (output.duration_ms) {
    lines.push(`Duration: ${formatDuration(output.duration_ms / 1000)}`);
  }

  return lines.join("\n");
}

/**
 * Prepare operation - check size, disk space, estimates
 */
async function* prepareDownload(
  input: z.infer<typeof prepareInputSchema>,
  context: ToolContext,
): AsyncGenerator<ToolYield<PrepareOutput>> {
  const { url, destination } = input;

  // Get remote file info
  const fileInfo = await getRemoteFileInfo(url, context.abortController.signal);

  // Get disk space
  const diskInfo = await getDiskSpace(destination);

  // Check if destination exists
  const destinationExists = await checkDestination(destination);

  // Calculate estimates
  let estimatedTime: { seconds: number; description: string } | null = null;
  let sufficientSpace = true;

  if (fileInfo.size !== null) {
    estimatedTime = estimateDownloadTime(fileInfo.size);
    if (diskInfo.available > 0) {
      // Add 10% buffer for safety
      sufficientSpace = diskInfo.available > fileInfo.size * 1.1;
    }
  }

  const output: PrepareOutput = {
    operation: "prepare",
    url,
    destination,
    file_size_bytes: fileInfo.size,
    file_size_human: fileInfo.size !== null
      ? formatBytes(fileInfo.size)
      : "unknown",
    content_type: fileInfo.contentType,
    supports_resume: fileInfo.supportsResume,
    available_space_bytes: diskInfo.available,
    available_space_human: formatBytes(diskInfo.available),
    destination_exists: destinationExists,
    sufficient_space: sufficientSpace,
    estimated_time_seconds: estimatedTime?.seconds ?? null,
    estimated_time_human: estimatedTime?.description ??
      "unknown (size unavailable)",
    error: fileInfo.error || diskInfo.error,
    network_error: fileInfo.networkError,
  };

  yield {
    type: "result",
    data: output,
    resultForAssistant: renderOutput(output),
  };
}

/**
 * Execute download with chosen method
 */
async function* executeDownload(
  input: z.infer<typeof downloadInputSchema>,
  context: ToolContext,
): AsyncGenerator<ToolYield<DownloadOutput>> {
  const {
    url,
    destination,
    method,
    necessity,
    necessity_detail,
    session_name,
    resume = true,
  } = input;
  const sessionName = session_name || "panpan-download";

  // Check if destination exists (for resume logic)
  const destinationExists = await checkDestination(destination);

  // Ensure destination directory exists
  const destDir = destination.substring(0, destination.lastIndexOf("/"));
  if (destDir) {
    try {
      await Deno.mkdir(destDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  if (method === "manual") {
    // Just return the command for user to run
    const command = buildCommandString(
      url,
      destination,
      resume,
      destinationExists,
    );
    const output: DownloadOutput = {
      operation: "download",
      method: "manual",
      url,
      destination,
      necessity,
      necessity_detail,
      command,
      instructions:
        `Run this command to download:\n\n  ${command}\n\nTo run in background:\n  nohup ${command} > download.log 2>&1 &\n\nTo monitor progress:\n  tail -f download.log`,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: renderOutput(output),
    };
    return;
  }

  if (method === "nohup") {
    // Start download in background with nohup
    const command = buildCommandString(
      url,
      destination,
      resume,
      destinationExists,
    );
    const logFile = `${destination}.download.log`;

    const nohupCmd = new Deno.Command("bash", {
      args: ["-c", `nohup ${command} > "${logFile}" 2>&1 & echo $!`],
      cwd: context.cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, success } = await nohupCmd.output();
    const pid = new TextDecoder().decode(stdout).trim();

    const output: DownloadOutput = {
      operation: "download",
      method: "nohup",
      url,
      destination,
      necessity,
      necessity_detail,
      command,
      session_name: pid,
      check_command:
        `tail -f "${logFile}"  # Monitor progress\nps -p ${pid}  # Check if running\nkill ${pid}  # Stop download`,
      success,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: renderOutput(output),
    };
    return;
  }

  if (method === "tmux") {
    // Start download in tmux session
    const command = buildCommandString(
      url,
      destination,
      resume,
      destinationExists,
    );

    // Check if tmux is available
    const checkTmux = new Deno.Command("which", {
      args: ["tmux"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success: hasTmux } = await checkTmux.output();

    if (!hasTmux) {
      const output: DownloadOutput = {
        operation: "download",
        method: "tmux",
        url,
        destination,
        necessity,
        necessity_detail,
        error: "tmux is not installed. Use 'nohup' or 'manual' method instead.",
      };
      yield {
        type: "result",
        data: output,
        resultForAssistant: renderOutput(output),
      };
      return;
    }

    // Wrap command in bash -c for proper escaping
    const tmuxCmd = new Deno.Command("tmux", {
      args: ["new-session", "-d", "-s", sessionName, "bash", "-c", command],
      cwd: context.cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stderr } = await tmuxCmd.output();

    if (!success) {
      const errorMsg = new TextDecoder().decode(stderr);
      const output: DownloadOutput = {
        operation: "download",
        method: "tmux",
        url,
        destination,
        necessity,
        necessity_detail,
        error: `Failed to create tmux session: ${errorMsg}`,
      };
      yield {
        type: "result",
        data: output,
        resultForAssistant: renderOutput(output),
      };
      return;
    }

    const output: DownloadOutput = {
      operation: "download",
      method: "tmux",
      url,
      destination,
      necessity,
      necessity_detail,
      command,
      session_name: sessionName,
      check_command:
        `tmux attach -t ${sessionName}  # Attach to monitor (Ctrl+B D to detach)\ntmux kill-session -t ${sessionName}  # Stop download`,
      success: true,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: renderOutput(output),
    };
    return;
  }

  if (method === "screen") {
    // Start download in screen session
    const command = buildCommandString(
      url,
      destination,
      resume,
      destinationExists,
    );

    // Check if screen is available
    const checkScreen = new Deno.Command("which", {
      args: ["screen"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success: hasScreen } = await checkScreen.output();

    if (!hasScreen) {
      const output: DownloadOutput = {
        operation: "download",
        method: "screen",
        url,
        destination,
        necessity,
        necessity_detail,
        error:
          "screen is not installed. Use 'nohup' or 'manual' method instead.",
      };
      yield {
        type: "result",
        data: output,
        resultForAssistant: renderOutput(output),
      };
      return;
    }

    const screenCmd = new Deno.Command("screen", {
      args: ["-dmS", sessionName, "bash", "-c", command],
      cwd: context.cwd,
      stdout: "piped",
      stderr: "piped",
    });

    const { success, stderr } = await screenCmd.output();

    if (!success) {
      const errorMsg = new TextDecoder().decode(stderr);
      const output: DownloadOutput = {
        operation: "download",
        method: "screen",
        url,
        destination,
        necessity,
        necessity_detail,
        error: `Failed to create screen session: ${errorMsg}`,
      };
      yield {
        type: "result",
        data: output,
        resultForAssistant: renderOutput(output),
      };
      return;
    }

    const output: DownloadOutput = {
      operation: "download",
      method: "screen",
      url,
      destination,
      necessity,
      necessity_detail,
      command,
      session_name: sessionName,
      check_command:
        `screen -r ${sessionName}  # Attach to monitor (Ctrl+A D to detach)\nscreen -X -S ${sessionName} quit  # Stop download`,
      success: true,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: renderOutput(output),
    };
    return;
  }

  // Foreground download with streaming output
  const cmd = buildDownloadCommand(url, destination, resume, destinationExists);

  // Start output display
  if (context.outputDisplay) {
    context.outputDisplay.start("downloading", 60 * 60 * 1000); // 1 hour timeout display
  }

  const DOWNLOAD_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours max
  let result: CommandResult | undefined;

  for await (
    const item of executeCommandStreaming(
      cmd,
      context.cwd,
      DOWNLOAD_TIMEOUT,
      context.abortController,
    )
  ) {
    if ("stream" in item) {
      yield { type: "streaming_output", line: item };
    } else {
      result = item;
    }
  }

  if (context.outputDisplay) {
    context.outputDisplay.stop();
  }

  const output: DownloadOutput = {
    operation: "download",
    method: "foreground",
    url,
    destination,
    necessity,
    necessity_detail,
    exit_code: result?.exitCode,
    duration_ms: result?.durationMs,
    success: result?.exitCode === 0,
    error: result?.exitCode !== 0
      ? (result?.stderr || `Download failed with exit code ${result?.exitCode}`)
      : undefined,
  };

  yield {
    type: "result",
    data: output,
    resultForAssistant: renderOutput(output),
  };
}

export const DatasetDownloadTool: Tool<typeof inputSchema, Output> = {
  name: "DatasetDownload",
  description:
    `Download large files (datasets, model weights) with safety checks and user consent.

## Two-Phase Workflow

1. **Prepare** (operation="prepare"): Pre-flight checks before downloading
   - File size and content type (via HTTP HEAD)
   - Available disk space and sufficiency check (with 10% buffer)
   - Estimated download time (assumes ~10 MB/s)
   - Resume support detection (Accept-Ranges header)
   - Network error diagnosis with troubleshooting hints

2. **Inform user** and get consent:
   - Present size, time estimate, disk space status
   - Explain necessity (required/recommended/optional) and why
   - Let user choose download method or decline

3. **Download** (operation="download"): Execute with chosen method

## Download Methods

- **foreground**: Blocking with streaming progress (for smaller files or when monitoring needed)
- **nohup**: Background process with log file (survives terminal disconnect)
- **tmux**: Detached tmux session (can attach to monitor, Ctrl+B D to detach)
- **screen**: Detached screen session (can attach to monitor, Ctrl+A D to detach)
- **manual**: Returns wget command for user to run themselves

## Necessity Levels

Specify why the download is needed:
- **required**: Won't work without it (e.g., training data)
- **recommended**: Needed for full functionality (e.g., pretrained weights)
- **optional**: Nice to have (e.g., evaluation dataset)

Use necessity_detail for additional context.

## Network Error Handling

On network errors, provides specific troubleshooting hints for:
- Timeouts (proxy settings, VPN, mirrors)
- Connection refused/reset (retry, server status)
- DNS failures (check connection, alternate DNS)
- SSL/TLS errors (CA certs, corporate proxy)
- HTTP errors (403: auth/VPN, 404: URL check, 5xx: retry later)

## Resume Support

- Detects server support via Accept-Ranges header
- Uses wget -c only when resuming existing partial downloads
- Informs user if resume is not supported

IMPORTANT: Always call prepare first, inform user of size/time/necessity, get explicit consent before downloading.`,

  inputSchema,

  isReadOnly: (input) => input?.operation === "prepare",

  isConcurrencySafe: (input) => input?.operation === "prepare",

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    if (input.operation === "prepare") {
      yield* prepareDownload(input, context);
    } else {
      yield* executeDownload(input, context);
    }
  },

  renderResultForAssistant(output: Output): string {
    return renderOutput(output);
  },

  renderToolUseMessage(input: Input, { verbose }) {
    if (input.operation === "prepare") {
      if (verbose) {
        return `prepare download: ${input.url} → ${input.destination}`;
      }
      // Extract filename from URL for concise display
      const filename = input.url.split("/").pop() || input.url;
      const shortName = filename.length > 30
        ? filename.slice(0, 29) + "…"
        : filename;
      return `check: ${shortName}`;
    }

    // Download operation
    const { method, url, destination, necessity } = input;
    if (verbose) {
      return `download (${method}, ${necessity}): ${url} → ${destination}`;
    }

    const filename = url.split("/").pop() || url;
    const shortName = filename.length > 25
      ? filename.slice(0, 24) + "…"
      : filename;
    return `${method}: ${shortName}`;
  },
};
