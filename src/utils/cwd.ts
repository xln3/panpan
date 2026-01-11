/**
 * Working directory state management
 */

let currentWorkingDirectory: string = Deno.cwd();

/**
 * Get current working directory
 */
export function getCwd(): string {
  return currentWorkingDirectory;
}

/**
 * Set current working directory
 */
export function setCwd(path: string): void {
  currentWorkingDirectory = path;
}

/**
 * Reset to actual process cwd
 */
export function resetCwd(): void {
  currentWorkingDirectory = Deno.cwd();
}
