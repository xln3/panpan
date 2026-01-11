/**
 * PM Budget Tool - Track and check budget for PM SA sessions
 * Manages token, time, and attempt limits
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { BudgetTracker, type BudgetStatus } from "../../services/pm/mod.ts";

const inputSchema = z.object({
  action: z.enum(["init", "check", "add_tokens", "add_attempt", "report"]),
  token_limit: z.number().optional().describe(
    "Maximum tokens allowed (default: 50000)",
  ),
  time_limit: z.number().optional().describe(
    "Maximum time in ms (default: 600000 = 10min)",
  ),
  attempts_limit: z.number().optional().describe(
    "Maximum retry attempts (default: 10)",
  ),
  tokens: z.number().optional().describe(
    "Number of tokens to add (required for add_tokens)",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface BudgetOutput {
  status?: string;
  withinBudget?: boolean;
  budget?: BudgetStatus;
  exhaustionReason?: string | null;
  report?: string;
  error?: string;
}

// Global budget tracker - shared across PM SA session
let activeBudgetTracker: BudgetTracker | null = null;

/**
 * PMBudget - Budget management tool for PM SA
 *
 * Used by PM SA to:
 * - Initialize session budget
 * - Check if still within budget
 * - Track token usage and attempts
 * - Generate budget reports
 */
export const PMBudgetTool: Tool<typeof inputSchema, BudgetOutput> = {
  name: "PMBudget",
  description: `Manage PM session budget limits.
Actions:
- init: Initialize budget with limits (call at session start)
- check: Check if still within budget
- add_tokens: Record token usage
- add_attempt: Record a verification attempt
- report: Generate budget usage report`,

  inputSchema,

  isReadOnly: () => true, // Doesn't modify filesystem
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<BudgetOutput>> {
    switch (input.action) {
      case "init": {
        activeBudgetTracker = new BudgetTracker({
          tokenLimit: input.token_limit || 50000,
          timeLimit: input.time_limit || 600000, // 10 minutes default
          attemptsLimit: input.attempts_limit || 10,
        });

        const status = activeBudgetTracker.getStatus();
        yield {
          type: "result",
          data: { status: "initialized", budget: status },
          resultForAssistant:
            `预算已初始化：Token ${status.tokenLimit}, 时间 ${Math.round(status.timeLimit / 1000)}s, 尝试 ${status.attemptsLimit} 次`,
        };
        break;
      }

      case "check": {
        if (!activeBudgetTracker) {
          yield {
            type: "result",
            data: { error: "预算未初始化，请先调用 init" },
          };
          return;
        }

        const status = activeBudgetTracker.getStatus();
        const withinBudget = activeBudgetTracker.isWithinBudget();
        const reason = activeBudgetTracker.getExhaustionReason();

        yield {
          type: "result",
          data: {
            withinBudget,
            budget: status,
            exhaustionReason: reason,
          },
          resultForAssistant: withinBudget
            ? `预算充足：Token ${status.tokenPercent}%, 时间 ${status.timePercent}%, 尝试 ${status.attemptsUsed}/${status.attemptsLimit}`
            : `⚠️ 预算已耗尽：${reason}`,
        };
        break;
      }

      case "add_tokens": {
        if (!activeBudgetTracker) {
          yield {
            type: "result",
            data: { error: "预算未初始化，请先调用 init" },
          };
          return;
        }

        if (input.tokens === undefined) {
          yield {
            type: "result",
            data: { error: "tokens is required for add_tokens action" },
          };
          return;
        }

        activeBudgetTracker.addTokens(input.tokens);
        const status = activeBudgetTracker.getStatus();

        yield {
          type: "result",
          data: { status: "tokens_added", budget: status },
          resultForAssistant:
            `已记录 ${input.tokens} tokens，当前使用 ${status.tokenPercent}%`,
        };
        break;
      }

      case "add_attempt": {
        if (!activeBudgetTracker) {
          yield {
            type: "result",
            data: { error: "预算未初始化，请先调用 init" },
          };
          return;
        }

        activeBudgetTracker.addAttempt();
        const status = activeBudgetTracker.getStatus();

        yield {
          type: "result",
          data: { status: "attempt_added", budget: status },
          resultForAssistant:
            `已记录一次尝试，剩余 ${status.attemptsLimit - status.attemptsUsed} 次`,
        };
        break;
      }

      case "report": {
        if (!activeBudgetTracker) {
          yield {
            type: "result",
            data: { error: "预算未初始化，请先调用 init" },
          };
          return;
        }

        const report = activeBudgetTracker.getReport();
        yield {
          type: "result",
          data: { report },
          resultForAssistant: report,
        };
        break;
      }
    }
  },

  renderResultForAssistant(output: BudgetOutput): string {
    if (output.error) return `错误: ${output.error}`;
    if (output.report) return output.report;
    if (output.withinBudget !== undefined) {
      return output.withinBudget ? "预算充足" : `预算耗尽: ${output.exhaustionReason}`;
    }
    return output.status || "操作完成";
  },
};

/**
 * Reset the global budget tracker (for testing)
 */
export function resetBudgetTracker(): void {
  activeBudgetTracker = null;
}

/**
 * Get the current budget tracker (for internal use)
 */
export function getActiveBudgetTracker(): BudgetTracker | null {
  return activeBudgetTracker;
}
