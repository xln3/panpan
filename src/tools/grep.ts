/**
 * Grep tool - content search using regex
 *
 * Supports optional FTS5 index acceleration for faster searching.
 * FTS5 is used for simple text searches; regex patterns fall back to scanning.
 */

import { z } from "zod";
import { walk } from "@std/fs";
import { globToRegExp, isAbsolute, relative, resolve } from "@std/path";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";
import { getSearchIndexService } from "../services/search-index/mod.ts";

const inputSchema = z.object({
  pattern: z.string().describe("The regular expression pattern to search for"),
  path: z.string().optional().describe(
    "File or directory to search in. Defaults to current working directory.",
  ),
  glob: z.string().optional().describe(
    'Glob pattern to filter files (e.g. "*.ts", "*.{ts,tsx}")',
  ),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional()
    .default("files_with_matches").describe(
      "Output mode: 'content' shows matching lines, 'files_with_matches' shows file paths, 'count' shows match counts",
    ),
  "-i": z.boolean().optional().describe("Case insensitive search"),
  "-n": z.boolean().optional().default(true).describe("Show line numbers"),
  "-C": z.number().optional().describe(
    "Number of lines to show before and after each match",
  ),
  use_index: z.boolean().optional().default(true).describe(
    "Use FTS5 index for faster searching when available (default: true). Falls back to regex for complex patterns.",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  mode: string;
  matches: Array<{
    file: string;
    line?: number;
    content?: string;
    count?: number;
  }>;
  numFiles: number;
  truncated: boolean;
  usedIndex: boolean;
}

const MAX_MATCHES = 100;

export const GrepTool: Tool<typeof inputSchema, Output> = {
  name: "Grep",
  description:
    "A powerful search tool for finding patterns in files. Supports regex, glob filtering, and various output modes.",
  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const searchPath = input.path
      ? isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path)
      : context.cwd;

    const flags = input["-i"] ? "gi" : "g";

    // Try to use FTS5 index if available and appropriate
    const indexService = getSearchIndexService();
    const canUseIndex = input.use_index !== false &&
      indexService?.isInitialized() &&
      !input.glob && // FTS5 doesn't support glob filtering directly
      isSimplePattern(input.pattern); // FTS5 works best with simple patterns

    const matches: Output["matches"] = [];
    let truncated = false;
    let usedIndex = false;

    // Check if searchPath is a file
    const stat = await Deno.stat(searchPath);

    if (stat.isFile) {
      // Single file - always use regex
      const regex = new RegExp(input.pattern, flags);
      const results = await searchFile(
        searchPath,
        regex,
        input.output_mode ?? "files_with_matches",
        input["-C"],
      );
      matches.push(...results);
    } else if (canUseIndex && indexService) {
      // Try FTS5 for directory search
      try {
        const mode = input.output_mode ?? "files_with_matches";
        const ftsResults = await indexService.search(input.pattern, {
          limit: MAX_MATCHES,
          filesOnly: mode === "files_with_matches",
        });

        if (mode === "files_with_matches") {
          // Just return file paths
          for (const result of ftsResults) {
            matches.push({ file: result.filePath });
          }
        } else {
          // For content/count mode, we need to re-scan the files with regex
          // FTS5 gives us candidate files, regex gives us exact matches
          const regex = new RegExp(input.pattern, flags);
          const candidateFiles = new Set(ftsResults.map((r) => r.filePath));

          for (const filePath of candidateFiles) {
            if (matches.length >= MAX_MATCHES) break;
            try {
              const results = await searchFile(
                filePath,
                regex,
                mode,
                input["-C"],
              );
              matches.push(...results);
            } catch {
              // Skip files we can't read
            }
          }
        }

        truncated = matches.length >= MAX_MATCHES;
        usedIndex = true;
      } catch {
        // Fall back to filesystem scan on index error
        usedIndex = false;
      }
    }

    // Fall back to filesystem walk if index not used
    if (!usedIndex && stat.isDirectory) {
      const regex = new RegExp(input.pattern, flags);
      const globPattern = input.glob
        ? globToRegExp(input.glob, { extended: true, globstar: true })
        : null;

      for await (const entry of walk(searchPath, { includeDirs: false })) {
        if (context.abortController.signal.aborted) break;

        // Apply glob filter
        if (globPattern) {
          const relativePath = relative(searchPath, entry.path);
          if (
            !globPattern.test(relativePath) && !globPattern.test(entry.name)
          ) {
            continue;
          }
        }

        // Skip binary files (simple heuristic)
        if (isBinaryPath(entry.path)) continue;

        try {
          const results = await searchFile(
            entry.path,
            regex,
            input.output_mode ?? "files_with_matches",
            input["-C"],
          );

          matches.push(...results);

          if (matches.length >= MAX_MATCHES) {
            truncated = true;
            break;
          }
        } catch {
          // Skip files we can't read
        }
      }
    }

    const output: Output = {
      mode: input.output_mode ?? "files_with_matches",
      matches,
      numFiles: new Set(matches.map((m) => m.file)).size,
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
    if (output.matches.length === 0) {
      return "No matches found.";
    }

    let result: string;

    if (output.mode === "files_with_matches") {
      result = [...new Set(output.matches.map((m) => m.file))].join("\n");
    } else if (output.mode === "count") {
      result = output.matches.map((m) => `${m.file}: ${m.count}`).join("\n");
    } else {
      result = output.matches.map((m) => `${m.file}:${m.line}: ${m.content}`)
        .join("\n");
    }

    if (output.truncated) {
      result += `\n\n(Results truncated at ${MAX_MATCHES} matches)`;
    }

    return result;
  },

  renderToolUseMessage(input, { verbose, cwd }) {
    const { pattern, path, glob } = input;
    const parts = [`pattern: ${pattern}`];
    if (path) {
      const pathDisplay = verbose ? path : relative(cwd, path);
      parts.push(`path: ${pathDisplay}`);
    }
    if (glob) parts.push(`glob: ${glob}`);
    return parts.join(", ");
  },
};

async function searchFile(
  path: string,
  regex: RegExp,
  mode: string,
  context?: number,
): Promise<Output["matches"]> {
  const content = await Deno.readTextFile(path);
  const lines = content.split("\n");
  const results: Output["matches"] = [];

  if (mode === "count") {
    let count = 0;
    for (const line of lines) {
      const matches = line.match(regex);
      if (matches) count += matches.length;
    }
    if (count > 0) {
      results.push({ file: path, count });
    }
    return results;
  }

  if (mode === "files_with_matches") {
    for (const line of lines) {
      regex.lastIndex = 0; // Reset lastIndex for global regex
      if (regex.test(line)) {
        results.push({ file: path });
        break;
      }
    }
    return results;
  }

  // Content mode
  for (let i = 0; i < lines.length; i++) {
    regex.lastIndex = 0; // Reset lastIndex for global regex
    if (regex.test(lines[i])) {
      if (context && context > 0) {
        // Include context lines
        const start = Math.max(0, i - context);
        const end = Math.min(lines.length - 1, i + context);
        for (let j = start; j <= end; j++) {
          results.push({
            file: path,
            line: j + 1,
            content: lines[j],
          });
        }
      } else {
        results.push({
          file: path,
          line: i + 1,
          content: lines[i],
        });
      }
    }
  }

  return results;
}

/**
 * Check if a pattern is simple enough to use FTS5.
 * FTS5 works best with word-based patterns, not complex regex.
 */
function isSimplePattern(pattern: string): boolean {
  // Regex metacharacters that indicate complex patterns
  const complexChars = /[\\^$.*+?{}[\]|()]/;

  // If pattern has regex metacharacters, it's not simple
  if (complexChars.test(pattern)) {
    return false;
  }

  // Pattern is simple - just words/phrases
  return true;
}

function isBinaryPath(path: string): boolean {
  const binaryExtensions = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".webp",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".zip",
    ".tar",
    ".gz",
    ".rar",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".wasm",
    ".bin",
    ".mp3",
    ".mp4",
    ".avi",
    ".mov",
    ".webm",
    ".ttf",
    ".woff",
    ".woff2",
    ".eot",
  ];
  return binaryExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}
