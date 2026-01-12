/**
 * Tests for src/tools/file-read.ts
 */

import { assertEquals } from "@std/assert";
import { FileReadTool } from "../../src/tools/file-read.ts";
import {
  collectGenerator,
  createMockToolContext,
  createTempFile,
  withTempDir,
} from "../_helpers/mod.ts";
import type { ToolYield } from "../../src/types/tool.ts";
import { join } from "@std/path";

// =============================================================================
// Type helper
// =============================================================================

interface FileReadOutput {
  content: string;
  path: string;
  lineCount: number;
  truncated: boolean;
}

async function runFileRead(
  input: {
    file_path: string;
    offset?: number;
    limit?: number;
  },
  cwd: string,
  timestamps: Record<string, number> = {},
): Promise<{ output: FileReadOutput; timestamps: Record<string, number> }> {
  const context = createMockToolContext({
    cwd,
    readFileTimestamps: timestamps,
  });
  const results = await collectGenerator(FileReadTool.call(input, context));
  const result = results[0] as ToolYield<FileReadOutput>;
  const output = result.type === "result"
    ? result.data
    : { content: "", path: "", lineCount: 0, truncated: false };
  return { output, timestamps: context.readFileTimestamps };
}

// =============================================================================
// Basic read tests
// =============================================================================

Deno.test("FileReadTool - reads file content", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "Hello, world!");

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt") },
      dir,
    );

    assertEquals(output.content.includes("Hello, world!"), true);
    assertEquals(output.lineCount, 1);
  });
});

Deno.test("FileReadTool - adds line numbers", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "line1\nline2\nline3");

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt") },
      dir,
    );

    assertEquals(output.content.includes("1\t"), true);
    assertEquals(output.content.includes("2\t"), true);
    assertEquals(output.content.includes("3\t"), true);
  });
});

Deno.test("FileReadTool - formats line numbers with padding", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "line1\nline2");

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt") },
      dir,
    );

    // Line numbers should be right-padded to 6 chars
    const lines = output.content.split("\n");
    assertEquals(lines[0].match(/^\s+1\t/)?.[0].length, 7); // 6 chars + tab
  });
});

// =============================================================================
// Offset and limit tests
// =============================================================================

Deno.test("FileReadTool - handles offset parameter", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "line1\nline2\nline3\nline4\nline5");

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt"), offset: 3 },
      dir,
    );

    // Should start from line 3
    assertEquals(output.content.includes("line1"), false);
    assertEquals(output.content.includes("line2"), false);
    assertEquals(output.content.includes("line3"), true);
    assertEquals(output.content.includes("line4"), true);
    assertEquals(output.content.includes("line5"), true);
    assertEquals(output.lineCount, 3);
  });
});

Deno.test("FileReadTool - handles limit parameter", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "line1\nline2\nline3\nline4\nline5");

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt"), limit: 2 },
      dir,
    );

    assertEquals(output.lineCount, 2);
    assertEquals(output.content.includes("line1"), true);
    assertEquals(output.content.includes("line2"), true);
    assertEquals(output.content.includes("line3"), false);
    assertEquals(output.truncated, true);
  });
});

Deno.test("FileReadTool - handles offset and limit together", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "line1\nline2\nline3\nline4\nline5");

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt"), offset: 2, limit: 2 },
      dir,
    );

    assertEquals(output.lineCount, 2);
    assertEquals(output.content.includes("line1"), false);
    assertEquals(output.content.includes("line2"), true);
    assertEquals(output.content.includes("line3"), true);
    assertEquals(output.content.includes("line4"), false);
  });
});

Deno.test("FileReadTool - defaults to MAX_LINES (2000)", async () => {
  await withTempDir(async (dir) => {
    // Create a file with more than 2000 lines
    const lines = Array.from({ length: 2100 }, (_, i) => `line${i + 1}`).join(
      "\n",
    );
    await createTempFile(dir, "test.txt", lines);

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt") },
      dir,
    );

    assertEquals(output.lineCount, 2000);
    assertEquals(output.truncated, true);
  });
});

// =============================================================================
// Long line truncation tests
// =============================================================================

Deno.test("FileReadTool - truncates long lines", async () => {
  await withTempDir(async (dir) => {
    const longLine = "x".repeat(3000);
    await createTempFile(dir, "test.txt", longLine);

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt") },
      dir,
    );

    // Line should be truncated to MAX_LINE_LENGTH (2000) + "..."
    const contentLine = output.content.split("\t")[1];
    assertEquals(contentLine.length, 2003); // 2000 + "..."
    assertEquals(contentLine.endsWith("..."), true);
  });
});

// =============================================================================
// Path handling tests
// =============================================================================

Deno.test("FileReadTool - resolves relative path", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "content");

    const { output } = await runFileRead({ file_path: "test.txt" }, dir);

    assertEquals(output.path, join(dir, "test.txt"));
  });
});

Deno.test("FileReadTool - handles absolute path", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "test.txt");
    await createTempFile(dir, "test.txt", "content");

    const { output } = await runFileRead({ file_path: filePath }, "/other/cwd");

    assertEquals(output.path, filePath);
  });
});

// =============================================================================
// Validation tests
// =============================================================================

Deno.test("FileReadTool - validateInput fails for non-existent file", async () => {
  const context = createMockToolContext();
  const result = await FileReadTool.validateInput!(
    { file_path: "/non/existent/file.txt" },
    context,
  );

  assertEquals(result.result, false);
  assertEquals(result.message?.includes("does not exist"), true);
});

Deno.test("FileReadTool - validateInput fails for directory", async () => {
  await withTempDir(async (dir) => {
    const context = createMockToolContext({ cwd: dir });
    const result = await FileReadTool.validateInput!(
      { file_path: dir },
      context,
    );

    assertEquals(result.result, false);
    assertEquals(result.message?.includes("is a directory"), true);
  });
});

Deno.test("FileReadTool - validateInput passes for existing file", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "content");

    const context = createMockToolContext({ cwd: dir });
    const result = await FileReadTool.validateInput!(
      { file_path: "test.txt" },
      context,
    );

    assertEquals(result.result, true);
  });
});

// =============================================================================
// Timestamp tracking tests
// =============================================================================

Deno.test("FileReadTool - updates readFileTimestamps", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "test.txt");
    await createTempFile(dir, "test.txt", "content");

    const timestamps: Record<string, number> = {};
    const before = Date.now();

    await runFileRead({ file_path: filePath }, dir, timestamps);

    const after = Date.now();

    assertEquals(filePath in timestamps, true);
    assertEquals(timestamps[filePath] >= before, true);
    assertEquals(timestamps[filePath] <= after, true);
  });
});

Deno.test("FileReadTool - updates timestamp on re-read", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "test.txt");
    await createTempFile(dir, "test.txt", "content");

    const timestamps: Record<string, number> = {};
    await runFileRead({ file_path: filePath }, dir, timestamps);
    const firstTimestamp = timestamps[filePath];

    // Wait a bit
    await new Promise((r) => setTimeout(r, 10));

    await runFileRead({ file_path: filePath }, dir, timestamps);

    assertEquals(timestamps[filePath] > firstTimestamp, true);
  });
});

// =============================================================================
// Tool properties tests
// =============================================================================

Deno.test("FileReadTool - isReadOnly returns true", () => {
  assertEquals(FileReadTool.isReadOnly(), true);
});

Deno.test("FileReadTool - isConcurrencySafe returns true", () => {
  assertEquals(FileReadTool.isConcurrencySafe(), true);
});

// =============================================================================
// Render tests
// =============================================================================

Deno.test("FileReadTool - renders empty file correctly", () => {
  const output: FileReadOutput = {
    content: "",
    path: "/path/to/file.txt",
    lineCount: 0,
    truncated: false,
  };

  const result = FileReadTool.renderResultForAssistant(output);

  assertEquals(result, "(empty file)");
});

Deno.test("FileReadTool - renders content as-is", () => {
  const output: FileReadOutput = {
    content: "     1\tline1\n     2\tline2",
    path: "/path/to/file.txt",
    lineCount: 2,
    truncated: false,
  };

  const result = FileReadTool.renderResultForAssistant(output);

  assertEquals(result, output.content);
});

// =============================================================================
// Edge cases
// =============================================================================

Deno.test("FileReadTool - handles file with no newline at end", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "no newline");

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt") },
      dir,
    );

    assertEquals(output.lineCount, 1);
  });
});

Deno.test("FileReadTool - handles empty file", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "");

    const { output } = await runFileRead(
      { file_path: join(dir, "test.txt") },
      dir,
    );

    assertEquals(output.lineCount, 1); // Empty string split gives [""]
  });
});

Deno.test("FileReadTool - truncated flag reflects actual state", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "line1\nline2\nline3");

    // Read all lines - not truncated
    const { output: full } = await runFileRead({
      file_path: join(dir, "test.txt"),
    }, dir);
    assertEquals(full.truncated, false);

    // Read with limit - truncated
    const { output: limited } = await runFileRead(
      { file_path: join(dir, "test.txt"), limit: 2 },
      dir,
    );
    assertEquals(limited.truncated, true);
  });
});
