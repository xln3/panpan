/**
 * Glob tool - file pattern matching
 */

import { z } from "zod";
import { walk } from "@std/fs";
import { globToRegExp, isAbsolute, relative, resolve } from "@std/path";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";

const inputSchema = z.object({
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z.string().optional().describe(
    "The directory to search in. Defaults to current working directory.",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  filenames: string[];
  numFiles: number;
  durationMs: number;
  truncated: boolean;
}

const MAX_FILES = 100;

export const GlobTool: Tool<typeof inputSchema, Output> = {
  name: "Glob",
  description:
    "Fast file pattern matching tool that works with any codebase size. Supports glob patterns like '**/*.ts' or 'src/**/*.tsx'. Returns matching file paths.",
  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async validateInput({ path }, context) {
    if (!path) return { result: true };

    const fullPath = isAbsolute(path) ? path : resolve(context.cwd, path);
    try {
      const stat = await Deno.stat(fullPath);
      if (!stat.isDirectory) {
        return { result: false, message: `"${path}" is not a directory` };
      }
      return { result: true };
    } catch {
      return { result: false, message: `Directory "${path}" does not exist` };
    }
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const start = Date.now();
    const searchPath = input.path
      ? isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path)
      : context.cwd;

    const regex = globToRegExp(input.pattern, {
      extended: true,
      globstar: true,
    });
    const files: string[] = [];
    let truncated = false;

    try {
      for await (const entry of walk(searchPath, { includeDirs: false })) {
        if (context.abortController.signal.aborted) break;

        // Match against relative path from search root
        const relativePath = relative(searchPath, entry.path);
        if (regex.test(relativePath) || regex.test(entry.name)) {
          files.push(entry.path);
          if (files.length >= MAX_FILES) {
            truncated = true;
            break;
          }
        }
      }
    } catch (error) {
      // Permission errors etc - continue with what we have
      if (files.length === 0) {
        throw error;
      }
    }

    const output: Output = {
      filenames: files,
      numFiles: files.length,
      durationMs: Date.now() - start,
      truncated,
    };

    yield {
      type: "result",
      data: output,
      resultForAssistant: this.renderResultForAssistant(output),
    };
  },

  renderResultForAssistant(output: Output): string {
    if (output.numFiles === 0) {
      return "No files found matching the pattern.";
    }

    let result = output.filenames.join("\n");
    if (output.truncated) {
      result += `\n\n(Results truncated at ${MAX_FILES} files)`;
    }
    return result;
  },

  renderToolUseMessage(input, { verbose, cwd }) {
    const { pattern, path } = input;
    const pathDisplay = path ? (verbose ? path : relative(cwd, path)) : ".";
    return `pattern: ${pattern}, path: ${pathDisplay}`;
  },
};
