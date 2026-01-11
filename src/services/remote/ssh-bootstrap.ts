/**
 * SSH bootstrap for remote daemon installation and startup.
 * Handles SSH connection, Deno installation check, daemon deployment.
 */

import type { RemoteHost, DaemonInfo } from "../../types/remote.ts";
import {
  DAEMON_SOURCE,
  DAEMON_VERSION,
  getDenoCheckCommand,
  getDenoInstallCommand,
  getDenoPath,
} from "./daemon-binary.ts";

/** SSH bootstrap options */
export interface SSHBootstrapOptions {
  /** Whether to install Deno if not present (default: true) */
  installDeno?: boolean;
  /** Daemon auto-shutdown timeout in seconds (default: 1800 = 30min) */
  daemonTimeout?: number;
  /** SSH connection timeout in seconds (default: 10) */
  sshTimeout?: number;
}

/** SSH bootstrap result */
export interface SSHBootstrapResult {
  /** Whether bootstrap succeeded */
  success: boolean;
  /** Daemon info if successful */
  daemonInfo?: DaemonInfo;
  /** Error message if failed */
  error?: string;
}

/**
 * Bootstrap daemon on remote host via SSH.
 *
 * Process:
 * 1. Check if Deno is installed
 * 2. Install Deno if needed and allowed
 * 3. Upload daemon script
 * 4. Start daemon in background
 * 5. Return daemon info (port, token, pid)
 */
export async function bootstrapDaemon(
  host: RemoteHost,
  options: SSHBootstrapOptions = {}
): Promise<SSHBootstrapResult> {
  const {
    installDeno = true,
    daemonTimeout = 1800,
    sshTimeout = 10,
  } = options;

  try {
    const sshBase = buildSSHCommand(host, sshTimeout);

    // 1. Check if Deno is installed
    const denoCheck = await executeSSH(sshBase, getDenoCheckCommand());
    const denoNotFound = denoCheck.stdout.includes("DENO_NOT_FOUND");

    if (denoNotFound) {
      if (!installDeno) {
        return {
          success: false,
          error: "Deno not installed on remote host and installDeno=false",
        };
      }

      // Install Deno
      const installResult = await executeSSH(sshBase, getDenoInstallCommand());
      if (installResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to install Deno: ${installResult.stderr}`,
        };
      }
    }

    // 2. Upload daemon script
    const daemonPath = "/tmp/panpan-daemon.ts";
    await uploadFile(host, DAEMON_SOURCE, daemonPath, sshTimeout);

    // 3. Generate token
    const token = crypto.randomUUID();

    // 4. Start daemon in background
    const denoPath = getDenoPath();
    const startCmd = [
      `nohup ${denoPath} run --allow-all ${daemonPath} 0 ${token} ${daemonTimeout}`,
      `> /tmp/panpan-daemon.log 2>&1 &`,
      `sleep 1`,
      `&& cat /tmp/panpan-daemon.log | grep DAEMON_STARTED || cat /tmp/panpan-daemon.log`,
    ].join(" ");

    const startResult = await executeSSH(sshBase, startCmd);
    if (startResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to start daemon: ${startResult.stderr || startResult.stdout}`,
      };
    }

    // 5. Parse daemon info from output
    const match = startResult.stdout.match(/DAEMON_STARTED:(\{.*\})/);
    if (!match) {
      return {
        success: false,
        error: `Failed to parse daemon startup info. Output: ${startResult.stdout}`,
      };
    }

    const parsed = JSON.parse(match[1]) as { port: number; token: string; pid: number };
    const daemonInfo: DaemonInfo = {
      version: DAEMON_VERSION,
      pid: parsed.pid,
      port: parsed.port,
      startedAt: Date.now(),
      capabilities: ["exec", "file"],
    };

    // Store the actual token (the one we generated, not from output)
    (daemonInfo as DaemonInfo & { token: string }).token = token;

    return { success: true, daemonInfo };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Build SSH command arguments
 */
function buildSSHCommand(host: RemoteHost, timeout: number): string[] {
  const args = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${timeout}`,
    "-p", String(host.port),
  ];

  if (host.authMethod === "key" && host.keyPath) {
    // Expand ~ to home directory
    const keyPath = host.keyPath.replace(/^~/, Deno.env.get("HOME") || "");
    args.push("-i", keyPath);
  }

  args.push(`${host.username}@${host.hostname}`);

  return ["ssh", ...args];
}

/**
 * Execute command over SSH
 */
async function executeSSH(
  sshBase: string[],
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cmd = new Deno.Command(sshBase[0], {
    args: [...sshBase.slice(1), command],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await cmd.output();

  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    exitCode: output.code,
  };
}

/**
 * Upload file content to remote host via SSH
 */
async function uploadFile(
  host: RemoteHost,
  content: string,
  remotePath: string,
  timeout: number
): Promise<void> {
  const sshBase = buildSSHCommand(host, timeout);

  const cmd = new Deno.Command(sshBase[0], {
    args: [...sshBase.slice(1), `cat > ${remotePath}`],
    stdin: "piped",
    stdout: "null",
    stderr: "piped",
  });

  const process = cmd.spawn();
  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(content));
  await writer.close();

  const output = await process.output();
  if (output.code !== 0) {
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(`Failed to upload file: ${stderr}`);
  }
}

/**
 * Kill daemon on remote host (cleanup)
 */
export async function killRemoteDaemon(
  host: RemoteHost,
  pid: number,
  sshTimeout = 10
): Promise<void> {
  const sshBase = buildSSHCommand(host, sshTimeout);
  await executeSSH(sshBase, `kill ${pid} 2>/dev/null || true`);
}
