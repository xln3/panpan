/**
 * EnterPlanMode tool - enters plan mode for structured task planning
 */

import { z } from "zod";
import type { Tool } from "../types/tool.ts";
import { enterPlanMode, isPlanMode } from "../utils/plan-mode.ts";

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

interface Output {
  success: boolean;
  planFilePath?: string;
  error?: string;
}

const DESCRIPTION =
  `Use this tool to enter plan mode for structured task planning.

In plan mode:
- You can only use read-only tools (Read, Glob, Grep, WebFetch, WebSearch)
- You can edit only the plan file
- You should explore the codebase and design an implementation approach
- Write your plan to the plan file
- Call ExitPlanMode when your plan is ready for user approval

Use plan mode when:
- Starting a complex multi-step implementation
- The task requires architectural decisions
- Multiple valid approaches exist and you need to design a strategy`;

export const EnterPlanModeTool: Tool<typeof inputSchema, Output> = {
  name: "EnterPlanMode",
  description: DESCRIPTION,
  inputSchema,

  isReadOnly() {
    return false;
  },

  isConcurrencySafe() {
    return false;
  },

  async *call(_input: Input) {
    if (isPlanMode()) {
      yield {
        type: "result" as const,
        data: {
          success: false,
          error: "Already in plan mode",
        },
      };
      return;
    }

    const result = enterPlanMode();

    yield {
      type: "result" as const,
      data: {
        success: true,
        planFilePath: result.planFilePath,
      },
    };
  },

  renderResultForAssistant(output: Output): string {
    if (!output.success) {
      return `Error entering plan mode: ${output.error}`;
    }
    return `Entered plan mode. Plan file created at: ${output.planFilePath}

You are now in plan mode. You can only use read-only tools and edit the plan file.
Explore the codebase, design your implementation approach, and write your plan to the plan file.
Call ExitPlanMode when your plan is ready for user approval.`;
  },

  renderToolUseMessage() {
    return ""; // No parameters
  },
};
