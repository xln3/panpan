/**
 * PM Requirement Tool - Manage requirements for PM SA
 * Tracks requirement state, questions, and clarification status
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import {
  clarificationHelper,
  requirementsManager,
} from "../../services/pm/mod.ts";

const inputSchema = z.object({
  action: z.enum(["create", "analyze", "add_qa", "get_criteria", "list"]),
  requirement_text: z.string().optional().describe(
    "The original requirement text (required for create)",
  ),
  requirement_id: z.string().optional().describe(
    "The requirement ID (required for analyze, add_qa, get_criteria)",
  ),
  question: z.string().optional().describe(
    "The clarifying question asked (required for add_qa)",
  ),
  answer: z.string().optional().describe(
    "The user's answer (required for add_qa)",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface RequirementOutput {
  requirementId?: string;
  status?: string;
  isClear?: boolean;
  issues?: Array<{
    type: string;
    term: string;
    question: string;
    severity: string;
  }>;
  suggestedQuestions?: string[];
  acceptanceCriteria?: string[];
  requirements?: Array<{
    id: string;
    original: string;
    status: string;
    questionsCount: number;
  }>;
  error?: string;
}

/**
 * PMRequirement - Requirement management tool for PM SA
 *
 * Used by PM SA to:
 * - Create and track requirements
 * - Analyze if requirements are clear enough
 * - Record Q&A from clarification
 * - Extract acceptance criteria
 */
export const PMRequirementTool: Tool<typeof inputSchema, RequirementOutput> = {
  name: "PMRequirement",
  description: `Manage PM requirements state.
Actions:
- create: Create new requirement, returns requirement ID
- analyze: Analyze if requirement is clear enough, returns issues and suggested questions
- add_qa: Record a question-answer pair from clarification
- get_criteria: Extract acceptance criteria from requirement and Q&A history
- list: List all tracked requirements`,

  inputSchema,

  isReadOnly: () => true, // Doesn't modify filesystem
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<RequirementOutput>> {
    switch (input.action) {
      case "create": {
        if (!input.requirement_text) {
          yield {
            type: "result",
            data: { error: "requirement_text is required for create action" },
          };
          return;
        }

        const req = requirementsManager.create(input.requirement_text);
        yield {
          type: "result",
          data: { requirementId: req.id, status: "created" },
          resultForAssistant: `需求已创建，ID: ${req.id}`,
        };
        break;
      }

      case "analyze": {
        if (!input.requirement_id) {
          yield {
            type: "result",
            data: { error: "requirement_id is required for analyze action" },
          };
          return;
        }

        const req = requirementsManager.get(input.requirement_id);
        if (!req) {
          yield {
            type: "result",
            data: { error: `需求不存在: ${input.requirement_id}` },
          };
          return;
        }

        const analysis = clarificationHelper.analyzeRequirement(req.original);
        const output: RequirementOutput = {
          requirementId: req.id,
          isClear: analysis.isClear,
          issues: analysis.issues,
          suggestedQuestions: analysis.suggestedQuestions,
        };

        yield {
          type: "result",
          data: output,
          resultForAssistant: analysis.isClear
            ? "需求已足够清晰，可以开始实现"
            : `需求不够清晰，需要澄清以下问题：\n${
              analysis.suggestedQuestions.map((q, i) => `${i + 1}. ${q}`).join(
                "\n",
              )
            }`,
        };
        break;
      }

      case "add_qa": {
        if (!input.requirement_id || !input.question || !input.answer) {
          yield {
            type: "result",
            data: {
              error:
                "requirement_id, question, and answer are required for add_qa action",
            },
          };
          return;
        }

        const req = requirementsManager.get(input.requirement_id);
        if (!req) {
          yield {
            type: "result",
            data: { error: `需求不存在: ${input.requirement_id}` },
          };
          return;
        }

        requirementsManager.addQA(
          input.requirement_id,
          input.question,
          input.answer,
        );
        yield {
          type: "result",
          data: { status: "qa_added", requirementId: input.requirement_id },
          resultForAssistant: `已记录问答：Q: ${input.question} A: ${input.answer}`,
        };
        break;
      }

      case "get_criteria": {
        if (!input.requirement_id) {
          yield {
            type: "result",
            data: {
              error: "requirement_id is required for get_criteria action",
            },
          };
          return;
        }

        const req = requirementsManager.get(input.requirement_id);
        if (!req) {
          yield {
            type: "result",
            data: { error: `需求不存在: ${input.requirement_id}` },
          };
          return;
        }

        const criteria = clarificationHelper.extractAcceptanceCriteria(
          req.original,
          req.questions,
        );
        requirementsManager.setAcceptance(req.id, criteria);

        yield {
          type: "result",
          data: { requirementId: req.id, acceptanceCriteria: criteria },
          resultForAssistant: `验收标准：\n${
            criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
          }`,
        };
        break;
      }

      case "list": {
        const reqs = requirementsManager.list();
        yield {
          type: "result",
          data: {
            requirements: reqs.map((r) => ({
              id: r.id,
              original: r.original,
              status: r.status,
              questionsCount: r.questions.length,
            })),
          },
          resultForAssistant: reqs.length === 0
            ? "没有追踪中的需求"
            : `追踪中的需求：\n${
              reqs.map((r) =>
                `- ${r.id}: ${r.original.slice(0, 50)}... (${r.status})`
              ).join("\n")
            }`,
        };
        break;
      }
    }
  },

  renderResultForAssistant(output: RequirementOutput): string {
    if (output.error) return `错误: ${output.error}`;
    if (output.acceptanceCriteria) {
      return `验收标准：\n${
        output.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
      }`;
    }
    if (output.suggestedQuestions) {
      return output.isClear
        ? "需求已足够清晰"
        : `需要澄清：\n${output.suggestedQuestions.join("\n")}`;
    }
    if (output.requirements) {
      return `${output.requirements.length} 个需求`;
    }
    return output.status || "操作完成";
  },
};
