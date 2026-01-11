/**
 * FileWrite tool - create or overwrite files
 */

import { z } from "zod";
import { dirname, isAbsolute, relative, resolve } from "@std/path";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";

const inputSchema = z.object({
  file_path: z
    .string()
    .describe(
      "The absolute path to the file to write (must be absolute, not relative)",
    ),
  content: z.string().describe("The content to write to the file"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  success: boolean;
  path: string;
  bytes: number;
  created: boolean;
}

export const FileWriteTool: Tool<typeof inputSchema, Output> = {
  name: "Write",
  description: `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Parent directories will be created automatically if they don't exist.`,

  inputSchema,

  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async validateInput({ file_path }, context) {
    const fullPath = isAbsolute(file_path)
      ? file_path
      : resolve(context.cwd, file_path);

    // Check if file exists
    try {
      await Deno.stat(fullPath);
      // File exists - must have been read first
      if (!context.readFileTimestamps[fullPath]) {
        return {
          result: false,
          message:
            "File already exists. You must read the file first before overwriting it.",
        };
      }
    } catch {
      // File doesn't exist - OK to create
    }

    return { result: true };
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const fullPath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(context.cwd, input.file_path);

    // Check if file exists before writing
    let fileExists = false;
    try {
      await Deno.stat(fullPath);
      fileExists = true;
    } catch {
      fileExists = false;
    }

    // Create parent directories if needed
    const dir = dirname(fullPath);
    try {
      await Deno.mkdir(dir, { recursive: true });
    } catch {
      // Directory might already exist
    }

    // Write file
    await Deno.writeTextFile(fullPath, input.content);

    // Update read timestamp
    context.readFileTimestamps[fullPath] = Date.now();

    const output: Output = {
      success: true,
      path: fullPath,
      bytes: new TextEncoder().encode(input.content).length,
      created: !fileExists,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: this.renderResultForAssistant(output),
    };
  },

  renderResultForAssistant(output: Output): string {
    const action = output.created ? "Created" : "Overwrote";
    return `${action} ${output.path} (${output.bytes} bytes)`;
  },

  renderToolUseMessage(input, { verbose, cwd }) {
    const display = verbose ? input.file_path : relative(cwd, input.file_path);
    return `file: ${display}`;
  },
};
