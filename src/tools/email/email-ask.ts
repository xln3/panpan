/**
 * EmailAsk tool - sends choice request emails and waits for response
 *
 * Use this tool when you need user input but they're not at the terminal:
 * - Long-running tasks that need decisions
 * - Approval workflows
 * - Multi-option choices
 */

import { z } from "zod";
import type { Tool, ToolYield } from "../../types/tool.ts";
import { emailService } from "../../services/email/mod.ts";

const inputSchema = z.object({
  subject: z.string().min(1).describe("Email subject line"),
  description: z.string().min(1).describe(
    "Description of the decision needed (supports Markdown)",
  ),
  options: z
    .array(
      z.object({
        id: z.string().min(1).describe("Unique identifier for this option"),
        label: z.string().min(1).describe("Display label for the option"),
        description: z
          .string()
          .optional()
          .describe("Optional description of what this option does"),
      }),
    )
    .min(2)
    .max(6)
    .describe("Available options (2-6 options)"),
  timeout_minutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .default(30)
    .describe("How long to wait for response (1-1440 minutes, default: 30)"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  selected_option_id: string | null;
  selected_option_label: string | null;
  timed_out: boolean;
}

const DESCRIPTION = `Send a choice request email and wait for user response.

Use this tool when you need user input during long-running tasks:
- The user will receive an email with clickable option buttons
- When they click an option, the tool returns their choice
- If they don't respond within the timeout, the tool returns timed_out: true

Prerequisites:
- Email service must be configured via environment variables
- Callback server must be accessible (PANPAN_EMAIL_CALLBACK_URL)

Example:
{
  "subject": "Approval needed: Deploy to production",
  "description": "The staging tests passed. Should I deploy to production?",
  "options": [
    { "id": "deploy", "label": "Deploy Now", "description": "Deploy immediately to production" },
    { "id": "wait", "label": "Wait", "description": "Hold off until tomorrow" },
    { "id": "abort", "label": "Abort", "description": "Cancel the deployment" }
  ],
  "timeout_minutes": 60
}`;

export const EmailAskTool: Tool<typeof inputSchema, Output> = {
  name: "EmailAsk",
  description: DESCRIPTION,
  inputSchema,

  isReadOnly() {
    return true;
  },

  isConcurrencySafe() {
    return false; // Should wait for response before other operations
  },

  async *call(input: Input): AsyncGenerator<ToolYield<Output>> {
    // Check if email service is configured
    if (!emailService.isConfigured()) {
      yield {
        type: "result" as const,
        data: {
          selected_option_id: null,
          selected_option_label: null,
          timed_out: false,
        },
        resultForAssistant:
          "Email service not configured. Set PANPAN_SMTP_* and PANPAN_EMAIL_CALLBACK_* environment variables.",
      };
      return;
    }

    // Yield progress to show we're sending email
    yield {
      type: "progress" as const,
      content: `Sending choice email: "${input.subject}"...`,
    };

    // Send the choice email and wait
    const result = await emailService.sendChoiceRequest({
      subject: input.subject,
      description: input.description,
      options: input.options,
      timeoutMinutes: input.timeout_minutes || 30,
    });

    // Yield progress while waiting
    yield {
      type: "progress" as const,
      content: `Waiting for email response (timeout: ${
        input.timeout_minutes || 30
      } minutes)...`,
    };

    yield {
      type: "result" as const,
      data: {
        selected_option_id: result.selectedOptionId,
        selected_option_label: result.selectedOptionLabel,
        timed_out: result.timedOut,
      },
    };
  },

  renderResultForAssistant(output: Output): string {
    if (output.timed_out) {
      return "The email choice request timed out. No response was received.";
    }
    if (output.selected_option_id) {
      return `User selected: "${output.selected_option_label}" (id: ${output.selected_option_id})`;
    }
    return "No selection was made (email may have failed to send).";
  },

  renderToolUseMessage(input: Input): string | null {
    const optionLabels = input.options.map((o) => o.label).join(", ");
    return `📧 Sending choice email: "${input.subject}" [${optionLabels}]`;
  },
};
