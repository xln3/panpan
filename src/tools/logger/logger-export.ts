/**
 * LoggerExport Tool - Export logs to file
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { loggerService } from "../../services/logger/mod.ts";

const inputSchema = z.object({
  format: z.enum(["json", "markdown"]).default("markdown").describe(
    "Export format: json (machine-readable) or markdown (human-readable)",
  ),
  path: z.string().describe("Output file path (e.g., ./logs/session.md)"),
});

type Input = z.infer<typeof inputSchema>;

interface ExportOutput {
  success: boolean;
  path: string;
  format: string;
  entryCount: number;
  bytesWritten: number;
  error?: string;
}

export const LoggerExportTool: Tool<typeof inputSchema, ExportOutput> = {
  name: "LoggerExport",
  description: `Export operation logs to a file.

Formats:
- json: Machine-readable JSON array of all log entries
- markdown: Human-readable document with sections for tools, LLM calls, errors, etc.`,

  inputSchema,

  isReadOnly: () => false, // Writes to filesystem
  isConcurrencySafe: () => false,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<ExportOutput>> {
    yield {
      type: "progress",
      content: `Exporting logs to ${input.path}...`,
    };

    try {
      const content = loggerService.export(input.format);
      const bytes = new TextEncoder().encode(content);

      // Ensure parent directory exists
      const parentDir = input.path.substring(0, input.path.lastIndexOf("/"));
      if (parentDir) {
        try {
          await Deno.mkdir(parentDir, { recursive: true });
        } catch {
          // Directory might already exist
        }
      }

      await Deno.writeFile(input.path, bytes);

      const entryCount = loggerService.size();

      yield {
        type: "result",
        data: {
          success: true,
          path: input.path,
          format: input.format,
          entryCount,
          bytesWritten: bytes.length,
        },
        resultForAssistant: `Exported ${entryCount} log entries to ${input.path} (${bytes.length} bytes, ${input.format})`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      yield {
        type: "result",
        data: {
          success: false,
          path: input.path,
          format: input.format,
          entryCount: 0,
          bytesWritten: 0,
          error: errorMsg,
        },
        resultForAssistant: `Failed to export logs: ${errorMsg}`,
      };
    }
  },

  renderResultForAssistant(output: ExportOutput): string {
    if (output.error) {
      return `Export error: ${output.error}`;
    }
    return `Exported ${output.entryCount} entries to ${output.path} (${output.bytesWritten} bytes)`;
  },
};

// ============================================================================
// LoggerClear - Clear all logs (bonus utility)
// ============================================================================

const clearInputSchema = z.object({
  confirm: z.boolean().describe("Must be true to confirm clearing all logs"),
});

interface ClearOutput {
  cleared: boolean;
  previousCount: number;
}

export const LoggerClearTool: Tool<typeof clearInputSchema, ClearOutput> = {
  name: "LoggerClear",
  description: "Clear all log entries. Requires confirm=true.",

  inputSchema: clearInputSchema,

  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async *call(
    input: z.infer<typeof clearInputSchema>,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<ClearOutput>> {
    if (!input.confirm) {
      yield {
        type: "result",
        data: { cleared: false, previousCount: loggerService.size() },
        resultForAssistant: "Clear cancelled: confirm must be true",
      };
      return;
    }

    const previousCount = loggerService.size();
    loggerService.clear();

    yield {
      type: "result",
      data: { cleared: true, previousCount },
      resultForAssistant: `Cleared ${previousCount} log entries`,
    };
  },

  renderResultForAssistant(output: ClearOutput): string {
    return output.cleared
      ? `Cleared ${output.previousCount} entries`
      : "Clear cancelled";
  },
};
