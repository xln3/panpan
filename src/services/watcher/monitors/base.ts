import type {
  Monitor,
  MonitorReading,
  MonitorType,
} from "../../../types/watcher.ts";

/**
 * Abstract base class for monitors.
 * Provides common functionality for executing commands and creating readings.
 */
export abstract class BaseMonitor implements Monitor {
  abstract type: MonitorType;
  abstract name: string;
  abstract description: string;

  /**
   * Check if this monitor can run on the current system
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Take a single sample
   */
  abstract sample(): Promise<MonitorReading>;

  /**
   * Get the command used for sampling (for remote execution)
   */
  abstract getCommand(): string;

  /**
   * Parse command output into a reading
   */
  abstract parseOutput(stdout: string): MonitorReading;

  /**
   * Create a standard reading object with common fields populated.
   * @param values - Key-value pairs of metric values
   * @param target - The target being monitored (default: "local")
   */
  protected createReading(
    values: Record<string, number | string>,
    target: string = "local",
  ): MonitorReading {
    return {
      monitorId: `${this.type}-${target}`,
      type: this.type,
      target,
      timestamp: Date.now(),
      values,
    };
  }

  /**
   * Execute a shell command locally and return stdout.
   * @param command - The shell command to execute
   * @throws Error if command fails
   */
  protected async executeCommand(command: string): Promise<string> {
    const cmd = new Deno.Command("bash", {
      args: ["-c", command],
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, stderr, success } = await cmd.output();

    if (!success) {
      const errorMessage = new TextDecoder().decode(stderr);
      throw new Error(`Command failed: ${errorMessage}`);
    }

    return new TextDecoder().decode(stdout);
  }

  /**
   * Check if a command exists on the system.
   * @param command - The command name to check
   */
  protected async commandExists(command: string): Promise<boolean> {
    try {
      await this.executeCommand(`which ${command}`);
      return true;
    } catch {
      return false;
    }
  }
}
