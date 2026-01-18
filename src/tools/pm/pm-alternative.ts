/**
 * PM Alternative Tool - Manage alternative approaches when blocked
 *
 * When primary approach fails, PM SA MUST use this tool to:
 * 1. Detect the blocker type
 * 2. Get alternatives sorted by confidence
 * 3. Try each alternative until one succeeds
 * 4. Report all attempts and results
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import type { AlternativePlan } from "../../types/pm.ts";
import {
  alternativeManager,
  COMMON_ALTERNATIVES,
} from "../../services/pm/alternative-manager.ts";

const inputSchema = z.object({
  action: z.enum([
    "detect",
    "init",
    "add",
    "next",
    "mark_success",
    "mark_failed",
    "list",
    "report",
  ]),
  error_message: z.string().optional().describe(
    "Error message to analyze (required for detect)",
  ),
  blocker_type: z.string().optional().describe(
    "Blocker type to initialize alternatives for (required for init)",
  ),
  description: z.string().optional().describe(
    "Description of custom alternative (required for add)",
  ),
  confidence: z.number().min(0).max(1).optional().describe(
    "Confidence score 0-1 (required for add)",
  ),
  plan_id: z.string().optional().describe(
    "Plan ID to mark (required for mark_success/mark_failed)",
  ),
  failure_reason: z.string().optional().describe(
    "Reason for failure (optional for mark_failed)",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface AlternativeOutput {
  blockerType?: string | null;
  availableTypes?: string[];
  alternatives?: AlternativePlan[];
  nextPlan?: AlternativePlan | null;
  addedPlan?: AlternativePlan;
  markedPlan?: { id: string; result: string };
  isExhausted?: boolean;
  successfulPlan?: AlternativePlan | null;
  report?: string;
  error?: string;
}

/**
 * PMAlternative - Alternative approach management for PM SA
 *
 * CRITICAL: When PM SA encounters a blocker (network error, download failure, etc.),
 * it MUST use this tool to systematically try alternatives instead of stopping.
 *
 * Workflow:
 * 1. detect: Analyze error message to identify blocker type
 * 2. init: Initialize predefined alternatives for blocker type
 * 3. next: Get next untried alternative (highest confidence first)
 * 4. Execute the alternative approach
 * 5. mark_success or mark_failed based on result
 * 6. Repeat 3-5 until success or exhausted
 * 7. report: Generate final report of all attempts
 */
export const PMAlternativeTool: Tool<typeof inputSchema, AlternativeOutput> = {
  name: "PMAlternative",
  description: `Manage alternative approaches when blocked.

**你必须在遇到阻断时使用此工具，不要停下来等待用户指示！**

Actions:
- detect: Analyze error message → returns blocker type
- init: Initialize alternatives for blocker type → returns sorted alternatives
- add: Add custom alternative plan
- next: Get next untried alternative (highest confidence first)
- mark_success: Mark plan as successful (stops the loop)
- mark_failed: Mark plan as failed with reason
- list: List all plans and their status
- report: Generate comprehensive attempt report

Available blocker types: ${Object.keys(COMMON_ALTERNATIVES).join(", ")}`,

  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<AlternativeOutput>> {
    switch (input.action) {
      case "detect": {
        if (!input.error_message) {
          yield {
            type: "result",
            data: { error: "error_message is required for detect action" },
          };
          return;
        }

        const blockerType = alternativeManager.detectBlockerType(
          input.error_message,
        );

        yield {
          type: "result",
          data: {
            blockerType,
            availableTypes: Object.keys(COMMON_ALTERNATIVES),
          },
          resultForAssistant: blockerType
            ? `检测到阻断类型: ${blockerType}。立即使用 init action 初始化备选方案！`
            : `未能自动检测阻断类型。可用类型: ${Object.keys(COMMON_ALTERNATIVES).join(", ")}。请手动指定 blocker_type 并调用 init。`,
        };
        break;
      }

      case "init": {
        if (!input.blocker_type) {
          yield {
            type: "result",
            data: { error: "blocker_type is required for init action" },
          };
          return;
        }

        const alternatives = alternativeManager.initForBlocker(
          input.blocker_type,
        );

        if (alternatives.length === 0) {
          yield {
            type: "result",
            data: {
              alternatives: [],
              error: `未知的阻断类型: ${input.blocker_type}`,
            },
          };
          return;
        }

        yield {
          type: "result",
          data: { alternatives },
          resultForAssistant: `已初始化 ${alternatives.length} 个备选方案（按置信度排序）：
${alternatives.map((a, i) => `${i + 1}. ${a.description} (${Math.round(a.confidence * 100)}%)`).join("\n")}

**立即调用 next action 获取第一个备选方案并执行！不要等待！**`,
        };
        break;
      }

      case "add": {
        if (!input.description || input.confidence === undefined) {
          yield {
            type: "result",
            data: {
              error: "description and confidence are required for add action",
            },
          };
          return;
        }

        const plan = alternativeManager.addPlan(
          input.description,
          input.confidence,
        );

        yield {
          type: "result",
          data: { addedPlan: plan },
          resultForAssistant: `已添加自定义备选方案: ${plan.description} (ID: ${plan.id})`,
        };
        break;
      }

      case "next": {
        const nextPlan = alternativeManager.getNextUntried();
        const isExhausted = alternativeManager.isExhausted();

        if (isExhausted) {
          const report = alternativeManager.generateReport();
          yield {
            type: "result",
            data: {
              nextPlan: null,
              isExhausted: true,
              successfulPlan: alternativeManager.getSuccessfulPlan(),
              report,
            },
            resultForAssistant: `⚠️ 所有备选方案已尝试完毕！\n\n${report}`,
          };
          return;
        }

        yield {
          type: "result",
          data: { nextPlan, isExhausted: false },
          resultForAssistant: nextPlan
            ? `下一个备选方案 (ID: ${nextPlan.id}):
📋 ${nextPlan.description}
📊 置信度: ${Math.round(nextPlan.confidence * 100)}%

**立即执行此方案！执行后调用 mark_success 或 mark_failed 记录结果！**`
            : "没有可用的备选方案",
        };
        break;
      }

      case "mark_success": {
        if (!input.plan_id) {
          yield {
            type: "result",
            data: { error: "plan_id is required for mark_success action" },
          };
          return;
        }

        alternativeManager.markTried(input.plan_id, "success");

        yield {
          type: "result",
          data: {
            markedPlan: { id: input.plan_id, result: "success" },
            successfulPlan: alternativeManager.getSuccessfulPlan(),
          },
          resultForAssistant: `✅ 方案 ${input.plan_id} 成功！阻断已解除，继续主任务。`,
        };
        break;
      }

      case "mark_failed": {
        if (!input.plan_id) {
          yield {
            type: "result",
            data: { error: "plan_id is required for mark_failed action" },
          };
          return;
        }

        alternativeManager.markTried(
          input.plan_id,
          "failed",
          input.failure_reason,
        );

        const nextPlan = alternativeManager.getNextUntried();
        const isExhausted = alternativeManager.isExhausted();

        yield {
          type: "result",
          data: {
            markedPlan: { id: input.plan_id, result: "failed" },
            nextPlan,
            isExhausted,
          },
          resultForAssistant: isExhausted
            ? `❌ 方案 ${input.plan_id} 失败${input.failure_reason ? `: ${input.failure_reason}` : ""}。所有备选方案已耗尽，请调用 report 生成报告。`
            : `❌ 方案 ${input.plan_id} 失败${input.failure_reason ? `: ${input.failure_reason}` : ""}。**立即调用 next 获取下一个方案！**`,
        };
        break;
      }

      case "list": {
        const alternatives = alternativeManager.listPlans();
        const isExhausted = alternativeManager.isExhausted();
        const successfulPlan = alternativeManager.getSuccessfulPlan();

        yield {
          type: "result",
          data: { alternatives, isExhausted, successfulPlan },
          resultForAssistant: alternatives.length === 0
            ? "没有备选方案。请先使用 detect 检测阻断类型，然后 init 初始化。"
            : `备选方案状态:\n${alternatives.map((a) => {
                const status = a.result === "success"
                  ? "✅"
                  : a.result === "failed"
                    ? "❌"
                    : "⏳";
                return `${status} ${a.description}${a.failureReason ? ` (失败: ${a.failureReason})` : ""}`;
              }).join("\n")}`,
        };
        break;
      }

      case "report": {
        const report = alternativeManager.generateReport();
        yield {
          type: "result",
          data: {
            report,
            successfulPlan: alternativeManager.getSuccessfulPlan(),
            isExhausted: alternativeManager.isExhausted(),
          },
          resultForAssistant: report,
        };
        break;
      }
    }
  },

  renderResultForAssistant(output: AlternativeOutput): string {
    if (output.error) return `错误: ${output.error}`;
    if (output.report) return output.report;
    if (output.nextPlan) {
      return `下一方案: ${output.nextPlan.description}`;
    }
    if (output.blockerType) {
      return `阻断类型: ${output.blockerType}`;
    }
    return "操作完成";
  },
};

/**
 * Reset the alternative manager (for testing)
 */
export function resetAlternativeManager(): void {
  alternativeManager.clear();
}
