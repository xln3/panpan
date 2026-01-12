/**
 * Tests for src/tools/grep.ts
 */

import { assertEquals } from "@std/assert";
import { GrepTool } from "../../src/tools/grep.ts";
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

interface GrepOutput {
  mode: string;
  matches: Array<{
    file: string;
    line?: number;
    content?: string;
    count?: number;
  }>;
  numFiles: number;
  truncated: boolean;
}

async function runGrep(
  input: {
    pattern: string;
    path?: string;
    glob?: string;
    output_mode?: "content" | "files_with_matches" | "count";
    "-i"?: boolean;
    "-n"?: boolean;
    "-C"?: number;
  },
  cwd: string,
): Promise<GrepOutput> {
  const context = createMockToolContext({ cwd });
  // Provide defaults for required fields
  const fullInput = {
    output_mode: "files_with_matches" as const,
    "-n": true,
    ...input,
  };
  const results = await collectGenerator(GrepTool.call(fullInput, context));
  const result = results[0] as ToolYield<GrepOutput>;
  return result.type === "result" ? result.data : {
    mode: "files_with_matches",
    matches: [],
    numFiles: 0,
    truncated: false,
  };
}

// =============================================================================
// Basic matching tests
// =============================================================================

Deno.test("GrepTool - matches regex pattern in files", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.ts": "const foo = 123;\nconst bar = 456;",
    });

    const output = await runGrep({ pattern: "foo" }, dir);

    assertEquals(output.numFiles, 1);
    assertEquals(output.matches.length, 1);
  });
});

Deno.test("GrepTool - case insensitive search with -i", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.ts": "const FOO = 123;\nconst foo = 456;",
    });

    // Without -i (case sensitive)
    const sensitive = await runGrep(
      { pattern: "foo", output_mode: "content" },
      dir,
    );
    assertEquals(sensitive.matches.length, 1);

    // With -i (case insensitive)
    const insensitive = await runGrep(
      { pattern: "foo", "-i": true, output_mode: "content" },
      dir,
    );
    assertEquals(insensitive.matches.length, 2);
  });
});

// =============================================================================
// Glob filter tests
// =============================================================================

Deno.test("GrepTool - filters files with glob pattern", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "file.ts": "target",
      "file.js": "target",
    });

    const output = await runGrep({ pattern: "target", glob: "*.ts" }, dir);

    assertEquals(output.numFiles, 1);
    assertEquals(output.matches[0].file.endsWith(".ts"), true);
  });
});

// =============================================================================
// Output mode tests
// =============================================================================

Deno.test("GrepTool - files_with_matches mode returns paths only", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.ts": "line1 match\nline2 match\nline3 match",
    });

    const output = await runGrep(
      { pattern: "match", output_mode: "files_with_matches" },
      dir,
    );

    assertEquals(output.mode, "files_with_matches");
    assertEquals(output.matches.length, 1); // Just the file, not each line
    assertEquals(output.matches[0].file.endsWith("test.ts"), true);
    assertEquals(output.matches[0].line, undefined);
  });
});

Deno.test("GrepTool - content mode returns matching lines", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.ts": "line1 match\nline2 no\nline3 match",
    });

    const output = await runGrep(
      { pattern: "match", output_mode: "content" },
      dir,
    );

    assertEquals(output.mode, "content");
    assertEquals(output.matches.length, 2);
    assertEquals(output.matches[0].line, 1);
    assertEquals(output.matches[0].content, "line1 match");
    assertEquals(output.matches[1].line, 3);
    assertEquals(output.matches[1].content, "line3 match");
  });
});

Deno.test("GrepTool - count mode returns match counts", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.ts": "match match match\nanother line",
    });

    const output = await runGrep(
      { pattern: "match", output_mode: "count" },
      dir,
    );

    assertEquals(output.mode, "count");
    assertEquals(output.matches.length, 1);
    assertEquals(output.matches[0].count, 3);
  });
});

// =============================================================================
// Context lines tests
// =============================================================================

Deno.test("GrepTool - includes context lines with -C", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.ts": "line1\nline2\nMATCH\nline4\nline5",
    });

    const output = await runGrep(
      { pattern: "MATCH", output_mode: "content", "-C": 1 },
      dir,
    );

    // Should include line2, MATCH, line4 (1 context line before and after)
    assertEquals(output.matches.length, 3);
    assertEquals(output.matches[0].line, 2);
    assertEquals(output.matches[1].line, 3);
    assertEquals(output.matches[2].line, 4);
  });
});

// =============================================================================
// Single file search tests
// =============================================================================

Deno.test("GrepTool - searches single file when path is file", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "target.ts": "find me",
      "other.ts": "find me too",
    });

    const output = await runGrep(
      { pattern: "find", path: "target.ts" },
      dir,
    );

    assertEquals(output.numFiles, 1);
    assertEquals(output.matches[0].file.endsWith("target.ts"), true);
  });
});

// =============================================================================
// Directory walk tests
// =============================================================================

Deno.test("GrepTool - walks directory recursively", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "root.ts": "target",
      "src/nested.ts": "target",
      "src/deep/file.ts": "target",
    });

    const output = await runGrep({ pattern: "target" }, dir);

    assertEquals(output.numFiles, 3);
  });
});

// =============================================================================
// Binary file handling tests
// =============================================================================

Deno.test("GrepTool - skips binary files", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "text.ts": "pattern",
      "image.png": "pattern", // Should be skipped based on extension
    });

    const output = await runGrep({ pattern: "pattern" }, dir);

    assertEquals(output.numFiles, 1);
    assertEquals(output.matches[0].file.endsWith(".ts"), true);
  });
});

// =============================================================================
// Truncation tests
// =============================================================================

Deno.test("GrepTool - truncates at MAX_MATCHES (100)", async () => {
  await withTempDir(async (dir) => {
    // Create many files with matches
    const files: Record<string, string> = {};
    for (let i = 0; i < 120; i++) {
      files[`file${i}.ts`] = "pattern";
    }
    await createTempStructure(dir, files);

    const output = await runGrep({ pattern: "pattern" }, dir);

    assertEquals(output.matches.length, 100);
    assertEquals(output.truncated, true);
  });
});

// =============================================================================
// Empty results tests
// =============================================================================

Deno.test("GrepTool - returns empty when no matches", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test.ts": "no match here",
    });

    const output = await runGrep({ pattern: "xyz123" }, dir);

    assertEquals(output.matches.length, 0);
    assertEquals(output.numFiles, 0);
  });
});

// =============================================================================
// Abort handling tests
// =============================================================================

Deno.test("GrepTool - respects abort signal", async () => {
  await withTempDir(async (dir) => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      files[`file${i}.ts`] = "pattern";
    }
    await createTempStructure(dir, files);

    const controller = new AbortController();
    const context = createMockToolContext({
      cwd: dir,
      abortController: controller,
    });

    // Abort immediately
    controller.abort();

    const results = await collectGenerator(
      GrepTool.call({
        pattern: "pattern",
        output_mode: "files_with_matches",
        "-n": true,
      }, context),
    );

    assertEquals(results.length, 1);
  });
});

// =============================================================================
// Tool properties tests
// =============================================================================

Deno.test("GrepTool - isReadOnly returns true", () => {
  assertEquals(GrepTool.isReadOnly(), true);
});

Deno.test("GrepTool - isConcurrencySafe returns true", () => {
  assertEquals(GrepTool.isConcurrencySafe(), true);
});

// =============================================================================
// Render tests
// =============================================================================

Deno.test("GrepTool - renders files_with_matches result", () => {
  const output: GrepOutput = {
    mode: "files_with_matches",
    matches: [{ file: "/path/file1.ts" }, { file: "/path/file2.ts" }],
    numFiles: 2,
    truncated: false,
  };

  const result = GrepTool.renderResultForAssistant(output);

  assertEquals(result.includes("/path/file1.ts"), true);
  assertEquals(result.includes("/path/file2.ts"), true);
});

Deno.test("GrepTool - renders count result", () => {
  const output: GrepOutput = {
    mode: "count",
    matches: [{ file: "/path/file.ts", count: 5 }],
    numFiles: 1,
    truncated: false,
  };

  const result = GrepTool.renderResultForAssistant(output);

  assertEquals(result.includes("/path/file.ts: 5"), true);
});

Deno.test("GrepTool - renders content result", () => {
  const output: GrepOutput = {
    mode: "content",
    matches: [{ file: "/path/file.ts", line: 10, content: "const x = 1;" }],
    numFiles: 1,
    truncated: false,
  };

  const result = GrepTool.renderResultForAssistant(output);

  assertEquals(result.includes("/path/file.ts:10:"), true);
  assertEquals(result.includes("const x = 1;"), true);
});

Deno.test("GrepTool - renders empty result message", () => {
  const output: GrepOutput = {
    mode: "files_with_matches",
    matches: [],
    numFiles: 0,
    truncated: false,
  };

  const result = GrepTool.renderResultForAssistant(output);

  assertEquals(result, "No matches found.");
});

Deno.test("GrepTool - renders truncation message", () => {
  const output: GrepOutput = {
    mode: "files_with_matches",
    matches: [{ file: "/path/file.ts" }],
    numFiles: 100,
    truncated: true,
  };

  const result = GrepTool.renderResultForAssistant(output);

  assertEquals(result.includes("truncated"), true);
});
