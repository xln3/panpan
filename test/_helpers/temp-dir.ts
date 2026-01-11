/**
 * Temporary directory management for tests
 */

import { join } from "@std/path";

/**
 * Create a temporary directory for testing
 */
export async function createTempDir(prefix = "panpan_test_"): Promise<string> {
  return await Deno.makeTempDir({ prefix });
}

/**
 * Clean up a temporary directory
 */
export async function cleanupTempDir(path: string): Promise<void> {
  try {
    await Deno.remove(path, { recursive: true });
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Create a file in the temp directory
 */
export async function createTempFile(
  dir: string,
  name: string,
  content: string,
): Promise<string> {
  const path = join(dir, name);
  await Deno.writeTextFile(path, content);
  return path;
}

/**
 * Structure type for createTempStructure - supports nested directories
 */
export type TempStructure = {
  [key: string]: string | TempStructure;
};

/**
 * Create directory structure (supports nested directories)
 */
export async function createTempStructure(
  dir: string,
  structure: TempStructure,
): Promise<void> {
  for (const [name, content] of Object.entries(structure)) {
    const path = join(dir, name);
    if (typeof content === "string") {
      // It's a file
      const parentDir = path.substring(0, path.lastIndexOf("/"));
      if (parentDir !== dir && parentDir.length > 0) {
        await Deno.mkdir(parentDir, { recursive: true });
      }
      await Deno.writeTextFile(path, content);
    } else {
      // It's a directory
      await Deno.mkdir(path, { recursive: true });
      await createTempStructure(path, content);
    }
  }
}

/**
 * Run a test with a temporary directory that's automatically cleaned up
 */
export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await createTempDir();
  try {
    return await fn(dir);
  } finally {
    await cleanupTempDir(dir);
  }
}
