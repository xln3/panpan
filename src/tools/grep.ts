/**
 * Grep tool - content search using regex
 */

import { z } from "zod";
import { walk } from "@std/fs";
import { globToRegExp, isAbsolute, relative, resolve } from "@std/path";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";

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
    const regex = new RegExp(input.pattern, flags);

    const globPattern = input.glob
      ? globToRegExp(input.glob, { extended: true, globstar: true })
      : null;

    const matches: Output["matches"] = [];
    let truncated = false;

    // Check if searchPath is a file or directory
    const stat = await Deno.stat(searchPath);

    if (stat.isFile) {
      // Search single file
      const results = await searchFile(
        searchPath,
        regex,
        input.output_mode ?? "files_with_matches",
        input["-C"],
      );
      matches.push(...results);
    } else {
      // Walk directory
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
      if (regex.test(line)) {
        results.push({ file: path });
        break;
      }
    }
    return results;
  }

  // Content mode
  for (let i = 0; i < lines.length; i++) {
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
