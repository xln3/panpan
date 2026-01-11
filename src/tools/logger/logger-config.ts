/**
 * LoggerConfig Tool - Configure logging level
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import type { LogLevel } from "../../types/logger.ts";
import { loggerService } from "../../services/logger/mod.ts";

const inputSchema = z.object({
  level: z.enum(["summary", "tool", "llm", "full"]).describe(
    "Log level: summary (brief), tool (+ tool calls), llm (+ LLM interactions), full (everything)",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface ConfigOutput {
  previousLevel: LogLevel;
  newLevel: LogLevel;
}

export const LoggerConfigTool: Tool<typeof inputSchema, ConfigOutput> = {
  name: "LoggerConfig",
  description: `Configure the logging verbosity level.

Levels (from least to most verbose):
- summary: Only high-level action summaries
- tool: + All tool calls and results
- llm: + LLM request/response details
- full: Everything including streaming output`,

  inputSchema,

  isReadOnly: () => false, // Changes config state
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<ConfigOutput>> {
    const previousLevel = loggerService.getLevel();
    loggerService.setLevel(input.level);

    yield {
      type: "result",
      data: { previousLevel, newLevel: input.level },
      resultForAssistant: `Log level changed: ${previousLevel} → ${input.level}`,
    };
  },

  renderResultForAssistant(output: ConfigOutput): string {
    return `Log level: ${output.previousLevel} → ${output.newLevel}`;
  },
};
