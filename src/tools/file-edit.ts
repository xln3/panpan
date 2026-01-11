/**
 * FileEdit tool - edit files with string replacement
 */

import { z } from "zod";
import { isAbsolute, relative, resolve } from "@std/path";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";

const inputSchema = z.object({
  file_path: z.string().describe("The absolute path to the file to modify"),
  old_string: z.string().describe("The text to replace"),
  new_string: z.string().describe(
    "The text to replace it with (must be different from old_string)",
  ),
  replace_all: z.boolean().optional().default(false).describe(
    "Replace all occurrences of old_string (default false)",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  success: boolean;
  path: string;
  replacements: number;
}

export const FileEditTool: Tool<typeof inputSchema, Output> = {
  name: "Edit",
  description:
    "Performs exact string replacements in files. The old_string must be unique in the file unless replace_all is true.",
  inputSchema,

  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async validateInput({ file_path, old_string, new_string }, context) {
    if (old_string === new_string) {
      return {
        result: false,
        message: "old_string and new_string must be different",
      };
    }

    const fullPath = isAbsolute(file_path)
      ? file_path
      : resolve(context.cwd, file_path);

    // Check if file was read before editing
    if (!context.readFileTimestamps[fullPath]) {
      return {
        result: false,
        message: "You must read the file before editing it",
      };
    }

    try {
      await Deno.stat(fullPath);
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

    // Count occurrences
    const occurrences = content.split(input.old_string).length - 1;

    if (occurrences === 0) {
      throw new Error(
        `old_string not found in file. Make sure it matches exactly including whitespace.`,
      );
    }

    if (occurrences > 1 && !input.replace_all) {
      throw new Error(
        `old_string found ${occurrences} times. Use replace_all: true to replace all, or provide more context to make it unique.`,
      );
    }

    // Perform replacement
    const newContent = input.replace_all
      ? content.replaceAll(input.old_string, input.new_string)
      : content.replace(input.old_string, input.new_string);

    await Deno.writeTextFile(fullPath, newContent);

    // Update read timestamp
    context.readFileTimestamps[fullPath] = Date.now();

    const output: Output = {
      success: true,
      path: fullPath,
      replacements: input.replace_all ? occurrences : 1,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: this.renderResultForAssistant(output),
    };
  },

  renderResultForAssistant(output: Output): string {
    return `Successfully edited ${output.path} (${output.replacements} replacement${
      output.replacements > 1 ? "s" : ""
    })`;
  },

  renderToolUseMessage(input, { verbose, cwd }) {
    const display = verbose ? input.file_path : relative(cwd, input.file_path);

    if (verbose) {
      const oldPreview = input.old_string.length > 100
        ? input.old_string.slice(0, 97) + "..."
        : input.old_string;
      const newPreview = input.new_string.length > 100
        ? input.new_string.slice(0, 97) + "..."
        : input.new_string;
      const replaceAll = input.replace_all ? " [replace_all]" : "";
      return `file: ${display}${replaceAll}\n  old: "${
        oldPreview.replace(/\n/g, "\\n")
      }"\n  new: "${newPreview.replace(/\n/g, "\\n")}"`;
    }

    return `file: ${display}`;
  },
};
