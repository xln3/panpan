/**
 * ExitPlanMode tool - exits plan mode after plan approval
 */

import { z } from "zod";
import type { Tool } from "../types/tool.ts";
import { exitPlanMode, isPlanMode } from "../utils/plan-mode.ts";

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

interface Output {
  success: boolean;
  planFilePath?: string;
  planContent?: string;
  error?: string;
}

const DESCRIPTION =
  `Use this tool to exit plan mode after your plan is ready for user approval.

Before calling this tool:
- Ensure you have written a complete implementation plan to the plan file
- The plan should include specific files to modify and implementation steps

After calling this tool:
- The user will review your plan
- If approved, you can proceed with implementation
- If not approved, you may need to revise the plan`;

export const ExitPlanModeTool: Tool<typeof inputSchema, Output> = {
  name: "ExitPlanMode",
  description: DESCRIPTION,
  inputSchema,

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async *call(_input: Input) {
    if (!isPlanMode()) {
      yield {
        type: "result" as const,
        data: {
          success: false,
          error: "Not in plan mode",
        },
      };
      return;
    }

    const result = exitPlanMode();

    if ("error" in result) {
      yield {
        type: "result" as const,
        data: {
          success: false,
          error: result.error,
        },
      };
      return;
    }

    yield {
      type: "result" as const,
      data: {
        success: true,
        planFilePath: result.planFilePath,
        planContent: result.planContent,
      },
    };
  },

  renderResultForAssistant(output: Output): string {
    if (!output.success) {
      return `Error exiting plan mode: ${output.error}`;
    }
    return `Exited plan mode. Plan saved to: ${output.planFilePath}

The user has approved your plan. You can now proceed with implementation.

Plan content:
${output.planContent}`;
  },

  renderToolUseMessage() {
    return ""; // No parameters
  },
};
