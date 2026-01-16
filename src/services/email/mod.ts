/**
 * Email notification service module
 *
 * Provides unified interface for:
 * - Status notifications (one-way)
 * - Choice requests (interactive with callback)
 *
 * @example
 * ```typescript
 * import { emailService, initEmailService } from "./services/email/mod.ts";
 *
 * // Initialize at startup (if configured)
 * await initEmailService();
 *
 * // Send status notification
 * await emailService.sendStatusNotification({
 *   subject: "Task completed",
 *   content: "Migration finished successfully",
 *   level: "success"
 * });
 *
 * // Send choice request and wait for response
 * const result = await emailService.sendChoiceRequest({
 *   subject: "Action required",
 *   description: "Choose the next step",
 *   options: [
 *     { id: "continue", label: "Continue" },
 *     { id: "abort", label: "Abort" }
 *   ],
 *   timeoutMinutes: 30
 * });
 * ```
 */

import type {
  ChoiceEmail,
  ChoiceRequestResult,
  EmailConfig,
  EmailSendResult,
  StatusEmail,
} from "../../types/email.ts";
import { pendingRequestManager } from "./pending-requests.ts";
import { ResponseServer } from "./response-server.ts";
import { SMTPClient } from "./smtp-client.ts";

// Re-export components
export {
  PendingRequestManager,
  pendingRequestManager,
} from "./pending-requests.ts";
export { ResponseServer, responseServer } from "./response-server.ts";
export { SMTPClient } from "./smtp-client.ts";

/**
 * Email service interface
 */
export interface EmailService {
  /** Check if email service is configured and ready */
  isConfigured(): boolean;

  /** Get current configuration (if any) */
  getConfig(): EmailConfig | null;

  /** Send a status notification email */
  sendStatusNotification(email: StatusEmail): Promise<EmailSendResult>;

  /** Send a choice request and wait for response */
  sendChoiceRequest(email: ChoiceEmail): Promise<ChoiceRequestResult>;
}

/**
 * Email service singleton implementation
 */
class EmailServiceImpl implements EmailService {
  private config: EmailConfig | null = null;
  private smtpClient: SMTPClient | null = null;
  private responseServer: ResponseServer | null = null;
  private initialized = false;

  isConfigured(): boolean {
    return this.config !== null && this.initialized;
  }

  getConfig(): EmailConfig | null {
    return this.config;
  }

  /**
   * Initialize the email service with configuration
   */
  async initialize(config: EmailConfig): Promise<void> {
    // Clean up existing if any
    await this.shutdown();

    this.config = config;
    this.smtpClient = new SMTPClient(config.smtp);
    this.responseServer = new ResponseServer(config.callbackPort);

    // Start the response server and pending request manager
    await this.responseServer.start();
    pendingRequestManager.start();
    this.initialized = true;
  }

  /**
   * Shutdown the email service
   */
  async shutdown(): Promise<void> {
    if (this.responseServer) {
      await this.responseServer.stop();
      this.responseServer = null;
    }

    if (this.smtpClient) {
      this.smtpClient.close();
      this.smtpClient = null;
    }

    pendingRequestManager.shutdown();
    this.initialized = false;
  }

  async sendStatusNotification(email: StatusEmail): Promise<EmailSendResult> {
    if (!this.isConfigured() || !this.smtpClient || !this.config) {
      return {
        success: false,
        error: "Email service not configured",
      };
    }

    return await this.smtpClient.sendStatus(this.config.recipients, email);
  }

  async sendChoiceRequest(email: ChoiceEmail): Promise<ChoiceRequestResult> {
    if (!this.isConfigured() || !this.smtpClient || !this.config) {
      return {
        selectedOptionId: null,
        selectedOptionLabel: null,
        timedOut: false,
      };
    }

    // Create pending request
    const token = pendingRequestManager.create(
      email.options,
      email.timeoutMinutes,
    );

    // Send email
    const sendResult = await this.smtpClient.sendChoice(
      this.config.recipients,
      email,
      token,
      this.config.callbackUrl,
    );

    if (!sendResult.success) {
      return {
        selectedOptionId: null,
        selectedOptionLabel: null,
        timedOut: false,
      };
    }

    // Wait for response
    const selectedId = await pendingRequestManager.waitForResponse(token);

    if (selectedId) {
      const option = email.options.find((o) => o.id === selectedId);
      return {
        selectedOptionId: selectedId,
        selectedOptionLabel: option?.label || null,
        timedOut: false,
      };
    }

    return {
      selectedOptionId: null,
      selectedOptionLabel: null,
      timedOut: true,
    };
  }
}

// Singleton instance
export const emailService = new EmailServiceImpl();

/**
 * Load email configuration from environment variables
 */
export function loadEmailConfig(): EmailConfig | null {
  const smtpHost = Deno.env.get("PANPAN_SMTP_HOST");
  const smtpPort = Deno.env.get("PANPAN_SMTP_PORT");
  const smtpUser = Deno.env.get("PANPAN_SMTP_USER");
  const smtpPass = Deno.env.get("PANPAN_SMTP_PASS");
  const smtpFrom = Deno.env.get("PANPAN_SMTP_FROM");
  const emailTo = Deno.env.get("PANPAN_EMAIL_TO");
  const callbackUrl = Deno.env.get("PANPAN_EMAIL_CALLBACK_URL");
  const callbackPort = Deno.env.get("PANPAN_EMAIL_CALLBACK_PORT");

  // Check required fields
  if (!smtpHost || !smtpUser || !smtpPass || !emailTo) {
    return null;
  }

  const port = parseInt(smtpPort || "465", 10);
  const secure = port === 465; // SSL for 465, TLS for others

  return {
    smtp: {
      host: smtpHost,
      port,
      user: smtpUser,
      pass: smtpPass,
      from: smtpFrom || smtpUser,
      secure,
    },
    recipients: emailTo.split(",").map((e) => e.trim()),
    callbackUrl: callbackUrl || `http://localhost:${callbackPort || "8765"}`,
    callbackPort: parseInt(callbackPort || "8765", 10),
  };
}

/**
 * Initialize email service from environment variables
 * Returns true if configured and initialized successfully
 */
export async function initEmailService(): Promise<boolean> {
  const config = loadEmailConfig();
  if (!config) {
    return false;
  }

  try {
    await (emailService as EmailServiceImpl).initialize(config);
    return true;
  } catch (error) {
    console.error("Failed to initialize email service:", error);
    return false;
  }
}

/**
 * Shutdown email service
 */
export async function shutdownEmailService(): Promise<void> {
  await (emailService as EmailServiceImpl).shutdown();
}
