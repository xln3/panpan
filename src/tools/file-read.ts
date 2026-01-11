/**
 * FileRead tool - read file contents
 */

import { z } from "zod";
import { isAbsolute, relative, resolve } from "@std/path";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";

const inputSchema = z.object({
  file_path: z.string().describe("The absolute path to the file to read"),
  offset: z.number().optional().describe(
    "The line number to start reading from (1-based). Only provide if the file is too large.",
  ),
  limit: z.number().optional().describe(
    "The number of lines to read. Only provide if the file is too large.",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  content: string;
  path: string;
  lineCount: number;
  truncated: boolean;
}

const MAX_LINES = 2000;
const MAX_LINE_LENGTH = 2000;

export const FileReadTool: Tool<typeof inputSchema, Output> = {
  name: "Read",
  description:
    "Reads a file from the local filesystem. Returns file content with line numbers. Can read partial content using offset and limit for large files.",
  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async validateInput({ file_path }, context) {
    const fullPath = isAbsolute(file_path)
      ? file_path
      : resolve(context.cwd, file_path);

    try {
      const stat = await Deno.stat(fullPath);
      if (stat.isDirectory) {
        return {
          result: false,
          message: `"${file_path}" is a directory, not a file`,
        };
      }
      return { result: true };
    } catch {
      return { result: false, message: `File "${file_path}" does not exist` };
    }
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const fullPath = isAbsolute(input.file_path)
      ? input.file_path
      : resolve(context.cwd, input.file_path);

    const content = await Deno.readTextFile(fullPath);
    const allLines = content.split("\n");

    // Apply offset and limit
    const offset = (input.offset ?? 1) - 1; // Convert to 0-based
    const limit = input.limit ?? MAX_LINES;
    const selectedLines = allLines.slice(offset, offset + limit);

    // Format with line numbers
    const formatted = selectedLines.map((line, i) => {
      const lineNum = offset + i + 1;
      const truncatedLine = line.length > MAX_LINE_LENGTH
        ? line.slice(0, MAX_LINE_LENGTH) + "..."
        : line;
      return `${String(lineNum).padStart(6, " ")}\t${truncatedLine}`;
    }).join("\n");

    // Track read timestamp for edit validation
    context.readFileTimestamps[fullPath] = Date.now();

    const output: Output = {
      content: formatted,
      path: fullPath,
      lineCount: selectedLines.length,
      truncated: selectedLines.length < allLines.length,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: this.renderResultForAssistant(output),
    };
  },

  renderResultForAssistant(output: Output): string {
    if (output.content === "") {
      return "(empty file)";
    }
    return output.content;
  },

  renderToolUseMessage(input, { verbose, cwd }) {
    const { file_path, offset, limit } = input;
    const display = verbose ? file_path : relative(cwd, file_path);
    const parts = [`file: ${display}`];
    if (offset) parts.push(`offset: ${offset}`);
    if (limit) parts.push(`limit: ${limit}`);
    return parts.join(", ");
  },
};
