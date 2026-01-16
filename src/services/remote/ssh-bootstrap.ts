/**
 * SSH bootstrap for remote daemon installation and startup.
 * Handles SSH connection, Deno installation check, daemon deployment.
 */

import type { DaemonInfo, RemoteHost } from "../../types/remote.ts";
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
  options: SSHBootstrapOptions = {},
): Promise<SSHBootstrapResult> {
  const {
    installDeno = true,
    daemonTimeout = 1800,
    sshTimeout = 10,
  } = options;

  try {
    const sshBase = buildSSHCommand(host, sshTimeout);

    // 1. Check if Deno is installed
    const denoCheck = await executeSSH(sshBase, getDenoCheckCommand(), host);
    const denoNotFound = denoCheck.stdout.includes("DENO_NOT_FOUND");

    if (denoNotFound) {
      if (!installDeno) {
        return {
          success: false,
          error: "Deno not installed on remote host and installDeno=false",
        };
      }

      // Install Deno
      const installResult = await executeSSH(
        sshBase,
        getDenoInstallCommand(),
        host,
      );
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

    const startResult = await executeSSH(sshBase, startCmd, host);
    if (startResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to start daemon: ${
          startResult.stderr || startResult.stdout
        }`,
      };
    }

    // 5. Parse daemon info from output
    const match = startResult.stdout.match(/DAEMON_STARTED:(\{.*\})/);
    if (!match) {
      return {
        success: false,
        error:
          `Failed to parse daemon startup info. Output: ${startResult.stdout}`,
      };
    }

    const parsed = JSON.parse(match[1]) as {
      port: number;
      token: string;
      pid: number;
    };
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
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `ConnectTimeout=${timeout}`,
    "-p",
    String(host.port),
  ];

  if (host.authMethod === "key" && host.keyPath) {
    // Key-based authentication - use BatchMode
    args.unshift("-o", "BatchMode=yes");
    const keyPath = host.keyPath.replace(/^~/, Deno.env.get("HOME") || "");
    args.push("-i", keyPath);
  } else if (host.authMethod === "agent") {
    // SSH agent - use BatchMode
    args.unshift("-o", "BatchMode=yes");
  }
  // For password auth, we don't use BatchMode - SSH_ASKPASS will be used

  args.push(`${host.username}@${host.hostname}`);
  return ["ssh", ...args];
}

/**
 * Create a temporary askpass script that echoes the password
 * Returns the path to the script (caller must clean up)
 */
async function createAskpassScript(password: string): Promise<string> {
  const scriptPath = await Deno.makeTempFile({
    prefix: "askpass_",
    suffix: ".sh",
  });
  const scriptContent = `#!/bin/sh\necho '${
    password.replace(/'/g, "'\"'\"'")
  }'`;
  await Deno.writeTextFile(scriptPath, scriptContent);
  await Deno.chmod(scriptPath, 0o700);
  return scriptPath;
}

/**
 * Execute command over SSH
 * For password auth, uses SSH_ASKPASS mechanism
 */
async function executeSSH(
  sshBase: string[],
  command: string,
  host?: RemoteHost,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let askpassScript: string | undefined;
  let env: Record<string, string> | undefined;

  // For password authentication, set up SSH_ASKPASS
  if (host?.authMethod === "password" && host.password) {
    askpassScript = await createAskpassScript(host.password);
    env = {
      ...Deno.env.toObject(),
      SSH_ASKPASS: askpassScript,
      SSH_ASKPASS_REQUIRE: "force", // Force use of askpass even with tty
      DISPLAY: Deno.env.get("DISPLAY") || ":0", // Required for SSH_ASKPASS
    };
  }

  try {
    // Use setsid to detach from terminal so SSH_ASKPASS is used
    const cmdArgs = host?.authMethod === "password" && host.password
      ? ["setsid", "-w", ...sshBase, command]
      : [...sshBase, command];

    const cmd = new Deno.Command(cmdArgs[0], {
      args: cmdArgs.slice(1),
      stdout: "piped",
      stderr: "piped",
      env,
    });

    const output = await cmd.output();

    return {
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
      exitCode: output.code,
    };
  } finally {
    // Clean up askpass script
    if (askpassScript) {
      try {
        await Deno.remove(askpassScript);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Upload file content to remote host via SSH
 * For password auth, uses SSH_ASKPASS mechanism
 */
async function uploadFile(
  host: RemoteHost,
  content: string,
  remotePath: string,
  timeout: number,
): Promise<void> {
  const sshBase = buildSSHCommand(host, timeout);

  let askpassScript: string | undefined;
  let env: Record<string, string> | undefined;

  // For password authentication, set up SSH_ASKPASS
  if (host.authMethod === "password" && host.password) {
    askpassScript = await createAskpassScript(host.password);
    env = {
      ...Deno.env.toObject(),
      SSH_ASKPASS: askpassScript,
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: Deno.env.get("DISPLAY") || ":0",
    };
  }

  try {
    // Use setsid for password auth to ensure SSH_ASKPASS is used
    const cmdArgs = host.authMethod === "password" && host.password
      ? ["setsid", "-w", ...sshBase, `cat > ${remotePath}`]
      : [...sshBase, `cat > ${remotePath}`];

    const cmd = new Deno.Command(cmdArgs[0], {
      args: cmdArgs.slice(1),
      stdin: "piped",
      stdout: "null",
      stderr: "piped",
      env,
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
  } finally {
    // Clean up askpass script
    if (askpassScript) {
      try {
        await Deno.remove(askpassScript);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Kill daemon on remote host (cleanup)
 */
export async function killRemoteDaemon(
  host: RemoteHost,
  pid: number,
  sshTimeout = 10,
): Promise<void> {
  const sshBase = buildSSHCommand(host, sshTimeout);
  await executeSSH(sshBase, `kill ${pid} 2>/dev/null || true`, host);
}
