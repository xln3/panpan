/**
 * LoggerQuery Tool - Query and analyze logs
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { loggerService } from "../../services/logger/mod.ts";

const inputSchema = z.object({
  format: z.enum(["summary", "timeline", "oneliner", "failures", "raw"])
    .default("summary").describe(
      "Output format: summary (stats), timeline (chronological), oneliner (brief), failures (error analysis), raw (JSON)",
    ),
  level: z.enum(["summary", "tool", "llm", "full"]).optional().describe(
    "Filter by minimum log level",
  ),
  type: z.string().optional().describe(
    "Filter by entry type: tool_call, tool_result, llm_request, llm_response, sa_invoke, error, etc.",
  ),
  limit: z.number().default(50).describe(
    "Maximum entries to return (for raw format)",
  ),
  failures_only: z.boolean().default(false).describe(
    "Only show failed operations",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface QueryOutput {
  format: string;
  content: string;
  entryCount: number;
}

export const LoggerQueryTool: Tool<typeof inputSchema, QueryOutput> = {
  name: "LoggerQuery",
  description: `Query and analyze operation logs.

Formats:
- summary: Statistics and overview of operations
- timeline: Chronological view of all operations
- oneliner: Very brief one-line summary
- failures: Analysis of failures with suggested fixes
- raw: Raw JSON log entries (use with filters)`,

  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<QueryOutput>> {
    let content: string;
    let entryCount = loggerService.size();

    switch (input.format) {
      case "summary":
        content = loggerService.getSummary();
        break;

      case "timeline":
        content = loggerService.getTimeline();
        break;

      case "oneliner":
        content = loggerService.getOneLiner();
        break;

      case "failures": {
        const failureSummary = loggerService.getFailureSummary();
        const alternatives = loggerService.getAlternativeRoutes();
        content = failureSummary;
        if (alternatives.length > 0) {
          content += "\n\nSuggested alternatives:\n" +
            alternatives.map((a, i) => `${i + 1}. ${a}`).join("\n");
        }
        break;
      }

      case "raw":
      default: {
        const logs = loggerService.query({
          level: input.level,
          type: input.type,
          limit: input.limit,
          failuresOnly: input.failures_only,
        });
        entryCount = logs.length;
        content = JSON.stringify(logs, null, 2);
        break;
      }
    }

    yield {
      type: "result",
      data: { format: input.format, content, entryCount },
      resultForAssistant: truncateContent(content, 4000),
    };
  },

  renderResultForAssistant(output: QueryOutput): string {
    return truncateContent(output.content, 4000);
  },
};

function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength) + "\n... (truncated)";
}
