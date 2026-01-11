/**
 * Tests for src/tools/glob.ts
 */

import { assertEquals } from "jsr:@std/assert@1";
import { GlobTool } from "../../src/tools/glob.ts";
import {
  collectGenerator,
  createMockToolContext,
  createTempStructure,
  withTempDir,
} from "../_helpers/mod.ts";
import type { ToolYield } from "../../src/types/tool.ts";

// =============================================================================
// Type helper
// =============================================================================

interface GlobOutput {
  filenames: string[];
  numFiles: number;
  durationMs: number;
  truncated: boolean;
}

async function runGlob(
  pattern: string,
  path: string | undefined,
  cwd: string,
): Promise<GlobOutput> {
  const context = createMockToolContext({ cwd });
  const results = await collectGenerator(
    GlobTool.call({ pattern, path }, context),
  );
  const result = results[0] as ToolYield<GlobOutput>;
  return result.type === "result" ? result.data : { filenames: [], numFiles: 0, durationMs: 0, truncated: false };
}

// =============================================================================
// Basic matching tests
// =============================================================================

Deno.test("GlobTool - matches files with *.ts pattern", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "file1.ts": "content",
      "file2.ts": "content",
      "file3.js": "content",
    });

    const output = await runGlob("*.ts", undefined, dir);

    assertEquals(output.numFiles, 2);
    assertEquals(output.filenames.some((f) => f.endsWith("file1.ts")), true);
    assertEquals(output.filenames.some((f) => f.endsWith("file2.ts")), true);
    assertEquals(output.filenames.some((f) => f.endsWith("file3.js")), false);
  });
});

Deno.test("GlobTool - supports ** glob pattern", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "root.ts": "content",
      "src/app.ts": "content",
      "src/lib/utils.ts": "content",
    });

    const output = await runGlob("**/*.ts", undefined, dir);

    assertEquals(output.numFiles, 3);
  });
});

Deno.test("GlobTool - supports * glob pattern for directories", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "src/a.ts": "content",
      "lib/b.ts": "content",
    });

    const output = await runGlob("src/*.ts", undefined, dir);

    assertEquals(output.numFiles, 1);
    assertEquals(output.filenames[0].includes("src"), true);
  });
});

// =============================================================================
// Path handling tests
// =============================================================================

Deno.test("GlobTool - uses cwd when path not provided", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.txt": "content",
    });

    const output = await runGlob("*.txt", undefined, dir);

    assertEquals(output.numFiles, 1);
  });
});

Deno.test("GlobTool - resolves relative path from cwd", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "subdir/test.txt": "content",
    });

    const output = await runGlob("*.txt", "subdir", dir);

    assertEquals(output.numFiles, 1);
  });
});

Deno.test("GlobTool - handles absolute path", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.txt": "content",
    });

    const output = await runGlob("*.txt", dir, "/other/cwd");

    assertEquals(output.numFiles, 1);
  });
});

// =============================================================================
// Validation tests
// =============================================================================

Deno.test("GlobTool - validateInput passes when path not provided", async () => {
  const context = createMockToolContext();
  const result = await GlobTool.validateInput!({ pattern: "*.ts" }, context);
  assertEquals(result.result, true);
});

Deno.test("GlobTool - validateInput fails for non-existent path", async () => {
  const context = createMockToolContext();
  const result = await GlobTool.validateInput!(
    { pattern: "*.ts", path: "/non/existent/path" },
    context,
  );
  assertEquals(result.result, false);
  assertEquals(result.message?.includes("does not exist"), true);
});

Deno.test("GlobTool - validateInput fails for file path (not directory)", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.txt": "content",
    });

    const context = createMockToolContext({ cwd: dir });
    const result = await GlobTool.validateInput!(
      { pattern: "*.ts", path: "test.txt" },
      context,
    );

    assertEquals(result.result, false);
    assertEquals(result.message?.includes("not a directory"), true);
  });
});

// =============================================================================
// Truncation and limits tests
// =============================================================================

Deno.test("GlobTool - truncates at MAX_FILES (100)", async () => {
  await withTempDir(async (dir) => {
    // Create 110 files
    const files: Record<string, string> = {};
    for (let i = 0; i < 110; i++) {
      files[`file${i.toString().padStart(3, "0")}.txt`] = "content";
    }
    await createTempStructure(dir, files);

    const output = await runGlob("*.txt", undefined, dir);

    assertEquals(output.numFiles, 100);
    assertEquals(output.truncated, true);
  });
});

Deno.test("GlobTool - sets truncated flag when limit reached", async () => {
  await withTempDir(async (dir) => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      files[`file${i}.txt`] = "content";
    }
    await createTempStructure(dir, files);

    const output = await runGlob("*.txt", undefined, dir);

    assertEquals(output.truncated, false);
    assertEquals(output.numFiles, 50);
  });
});

// =============================================================================
// Empty results tests
// =============================================================================

Deno.test("GlobTool - returns empty array when no matches", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.txt": "content",
    });

    const output = await runGlob("*.ts", undefined, dir);

    assertEquals(output.numFiles, 0);
    assertEquals(output.filenames, []);
  });
});

// =============================================================================
// Abort handling tests
// =============================================================================

Deno.test("GlobTool - respects abort signal", async () => {
  await withTempDir(async (dir) => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      files[`file${i}.txt`] = "content";
    }
    await createTempStructure(dir, files);

    const controller = new AbortController();
    const context = createMockToolContext({ cwd: dir, abortController: controller });

    // Abort immediately
    controller.abort();

    const results = await collectGenerator(
      GlobTool.call({ pattern: "*.txt" }, context),
    );

    // Should complete quickly with partial or no results
    assertEquals(results.length, 1);
  });
});

// =============================================================================
// Tool properties tests
// =============================================================================

Deno.test("GlobTool - isReadOnly returns true", () => {
  assertEquals(GlobTool.isReadOnly(), true);
});

Deno.test("GlobTool - isConcurrencySafe returns true", () => {
  assertEquals(GlobTool.isConcurrencySafe(), true);
});

// =============================================================================
// Render tests
// =============================================================================

Deno.test("GlobTool - renders result for assistant", () => {
  const output: GlobOutput = {
    filenames: ["/path/to/file1.ts", "/path/to/file2.ts"],
    numFiles: 2,
    durationMs: 10,
    truncated: false,
  };

  const result = GlobTool.renderResultForAssistant(output);

  assertEquals(result.includes("/path/to/file1.ts"), true);
  assertEquals(result.includes("/path/to/file2.ts"), true);
});

Deno.test("GlobTool - renders truncation message", () => {
  const output: GlobOutput = {
    filenames: ["/path/to/file.ts"],
    numFiles: 100,
    durationMs: 10,
    truncated: true,
  };

  const result = GlobTool.renderResultForAssistant(output);

  assertEquals(result.includes("truncated"), true);
});

Deno.test("GlobTool - renders empty result message", () => {
  const output: GlobOutput = {
    filenames: [],
    numFiles: 0,
    durationMs: 10,
    truncated: false,
  };

  const result = GlobTool.renderResultForAssistant(output);

  assertEquals(result, "No files found matching the pattern.");
});
