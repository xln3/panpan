/**
 * Test Finder - Locate existing test files in a project
 * Used by PM SA to find relevant tests for verification
 */

import type { TestCase } from "../../types/pm.ts";

/**
 * Finds existing test files in a project
 */
export class TestFinder {
  /**
   * Find test files related to a keyword
   */
  async findTests(keyword: string, cwd: string = Deno.cwd()): Promise<TestCase[]> {
    const tests: TestCase[] = [];

    // Common test directories
    const testDirs = ["test", "tests", "__tests__", "spec", "specs"];

    // Common test file patterns
    const testPatterns = [
      `*${keyword}*test*.ts`,
      `*${keyword}*spec*.ts`,
      `test*${keyword}*.ts`,
      `*${keyword}*.test.ts`,
      `*${keyword}*.spec.ts`,
      `*${keyword}_test.ts`,
    ];

    for (const dir of testDirs) {
      const testDir = `${cwd}/${dir}`;

      try {
        await Deno.stat(testDir);
      } catch {
        continue; // Directory doesn't exist
      }

      // Search for test files
      for (const pattern of testPatterns) {
        const files = await this.globFiles(testDir, pattern);
        for (const file of files) {
          tests.push({
            id: `existing-${file}`,
            requirementId: "",
            type: "existing",
            path: file,
            status: "pending",
          });
        }
      }
    }

    return tests;
  }

  /**
   * Find all test files in a directory
   */
  async findAllTests(cwd: string = Deno.cwd()): Promise<TestCase[]> {
    const tests: TestCase[] = [];
    const testDirs = ["test", "tests", "__tests__", "spec", "specs"];
    const testSuffixes = ["_test.ts", ".test.ts", ".spec.ts", "_spec.ts"];

    for (const dir of testDirs) {
      const testDir = `${cwd}/${dir}`;

      try {
        await Deno.stat(testDir);
      } catch {
        continue;
      }

      const files = await this.findFilesRecursively(testDir);
      for (const file of files) {
        if (testSuffixes.some((suffix) => file.endsWith(suffix))) {
          tests.push({
            id: `existing-${file}`,
            requirementId: "",
            type: "existing",
            path: file,
            status: "pending",
          });
        }
      }
    }

    return tests;
  }

  /**
   * Simple glob implementation
   */
  private async globFiles(dir: string, pattern: string): Promise<string[]> {
    const results: string[] = [];
    const regex = this.patternToRegex(pattern);

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && regex.test(entry.name)) {
          results.push(`${dir}/${entry.name}`);
        } else if (entry.isDirectory) {
          const subResults = await this.globFiles(`${dir}/${entry.name}`, pattern);
          results.push(...subResults);
        }
      }
    } catch {
      // Ignore read errors
    }

    return results;
  }

  /**
   * Find all files recursively in a directory
   */
  private async findFilesRecursively(dir: string): Promise<string[]> {
    const results: string[] = [];

    try {
      for await (const entry of Deno.readDir(dir)) {
        const fullPath = `${dir}/${entry.name}`;
        if (entry.isFile) {
          results.push(fullPath);
        } else if (entry.isDirectory) {
          const subResults = await this.findFilesRecursively(fullPath);
          results.push(...subResults);
        }
      }
    } catch {
      // Ignore read errors
    }

    return results;
  }

  /**
   * Convert glob pattern to regex
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i");
  }

  /**
   * Check if a test file contains specific keywords
   */
  async checkTestContent(testPath: string, keywords: string[]): Promise<boolean> {
    try {
      const content = await Deno.readTextFile(testPath);
      const contentLower = content.toLowerCase();

      return keywords.some((k) => contentLower.includes(k.toLowerCase()));
    } catch {
      return false;
    }
  }

  /**
   * Get test file info
   */
  async getTestInfo(testPath: string): Promise<{
    exists: boolean;
    size?: number;
    modified?: Date;
  }> {
    try {
      const stat = await Deno.stat(testPath);
      return {
        exists: true,
        size: stat.size,
        modified: stat.mtime ?? undefined,
      };
    } catch {
      return { exists: false };
    }
  }
}

// Singleton instance for global access
export const testFinder = new TestFinder();
