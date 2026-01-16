/**
 * EmailNotify tool - sends status notification emails
 *
 * Use this tool to notify users about important status updates:
 * - Task completion
 * - Errors or warnings
 * - Progress updates
 */

import { z } from "zod";
import type { Tool } from "../../types/tool.ts";
import { emailService } from "../../services/email/mod.ts";

const inputSchema = z.object({
  subject: z.string().min(1).describe("Email subject line"),
  content: z.string().min(1).describe(
    "Email content (supports Markdown formatting)",
  ),
  level: z
    .enum(["info", "warning", "error", "success"])
    .optional()
    .default("info")
    .describe("Visual indicator level for the notification"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  success: boolean;
  error?: string;
  messageId?: string;
}

const DESCRIPTION = `Send a status notification email to configured recipients.

Use this tool to notify users about:
- Task completion or progress
- Errors or warnings that need attention
- Important status updates

The email will be sent immediately without waiting for a response.

Prerequisites:
- Email service must be configured via environment variables
- PANPAN_SMTP_HOST, PANPAN_SMTP_USER, PANPAN_SMTP_PASS, PANPAN_EMAIL_TO are required

Example:
{
  "subject": "Task completed successfully",
  "content": "The migration has finished.\\n\\n**Summary:**\\n- Files migrated: 42\\n- Time taken: 5 minutes",
  "level": "success"
}`;

export const EmailNotifyTool: Tool<typeof inputSchema, Output> = {
  name: "EmailNotify",
  description: DESCRIPTION,
  inputSchema,

  isReadOnly() {
    return true; // Sending email doesn't modify local state
  },

  isConcurrencySafe() {
    return true; // Multiple emails can be sent concurrently
  },

  async *call(input: Input) {
    // Check if email service is configured
    if (!emailService.isConfigured()) {
      yield {
        type: "result" as const,
        data: {
          success: false,
          error:
            "Email service not configured. Set PANPAN_SMTP_* and PANPAN_EMAIL_TO environment variables.",
        },
      };
      return;
    }

    // Send the notification
    const result = await emailService.sendStatusNotification({
      subject: input.subject,
      content: input.content,
      level: input.level || "info",
    });

    yield {
      type: "result" as const,
      data: {
        success: result.success,
        error: result.error,
        messageId: result.messageId,
      },
    };
  },

  renderResultForAssistant(output: Output): string {
    if (output.success) {
      return `Email notification sent successfully${
        output.messageId ? ` (ID: ${output.messageId})` : ""
      }`;
    }
    return `Failed to send email: ${output.error}`;
  },

  renderToolUseMessage(input: Input): string | null {
    const levelEmoji: Record<string, string> = {
      info: "ℹ️",
      warning: "⚠️",
      error: "❌",
      success: "✅",
    };
    const emoji = levelEmoji[input.level || "info"];
    return `${emoji} Sending notification: "${input.subject}"`;
  },
};
