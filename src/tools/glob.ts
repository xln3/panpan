/**
 * Glob tool - file pattern matching
 *
 * Supports optional index acceleration via the search-index service.
 * When index is available, glob queries run in <10ms instead of 500-1000ms.
 */

import { z } from "zod";
import { walk } from "@std/fs";
import { globToRegExp, isAbsolute, relative, resolve } from "@std/path";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";
import { getSearchIndexService } from "../services/search-index/mod.ts";

const inputSchema = z.object({
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z.string().optional().describe(
    "The directory to search in. Defaults to current working directory.",
  ),
  use_index: z.boolean().optional().default(true).describe(
    "Use search index for faster matching (default: true). Set to false to force filesystem walk.",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  filenames: string[];
  numFiles: number;
  durationMs: number;
  truncated: boolean;
  usedIndex: boolean;
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

    // Try to use index if available and enabled
    const indexService = getSearchIndexService();
    const useIndex = input.use_index !== false && indexService?.isInitialized();

    let files: string[] = [];
    let truncated = false;
    let usedIndex = false;

    if (useIndex && indexService) {
      // Use index for fast glob matching
      try {
        files = await indexService.glob(input.pattern, searchPath, {
          limit: MAX_FILES,
        });
        truncated = files.length >= MAX_FILES;
        usedIndex = true;
      } catch {
        // Fall back to filesystem walk on index error
        usedIndex = false;
      }
    }

    // Fall back to filesystem walk if index not used
    if (!usedIndex) {
      const regex = globToRegExp(input.pattern, {
        extended: true,
        globstar: true,
      });

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
    }

    const output: Output = {
      filenames: files,
      numFiles: files.length,
      durationMs: Date.now() - start,
      truncated,
      usedIndex,
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
