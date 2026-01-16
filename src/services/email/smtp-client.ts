/**
 * SMTP email client for sending notifications
 *
 * Uses nodemailer for reliable email delivery with support for:
 * - SSL (port 465) and TLS (port 587)
 * - HTML templated emails
 * - Status notifications and interactive choice emails
 */

import nodemailer from "nodemailer";
import type {
  ChoiceEmail,
  EmailSendResult,
  SMTPConfig,
  StatusEmail,
} from "../../types/email.ts";

/**
 * SMTP client for sending emails
 */
export class SMTPClient {
  private transporter: nodemailer.Transporter;
  private config: SMTPConfig;

  constructor(config: SMTPConfig) {
    this.config = config;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure, // true for 465, false for other ports
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }

  /**
   * Verify SMTP connection
   */
  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a status notification email
   */
  async sendStatus(
    recipients: string[],
    email: StatusEmail,
  ): Promise<EmailSendResult> {
    const html = this.renderStatusEmail(email);

    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: recipients.join(", "),
        subject: email.subject,
        html,
        text: email.content,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send a choice request email with clickable option buttons
   */
  async sendChoice(
    recipients: string[],
    email: ChoiceEmail,
    token: string,
    callbackUrl: string,
  ): Promise<EmailSendResult> {
    const html = this.renderChoiceEmail(email, token, callbackUrl);
    const text = this.renderChoiceText(email, token, callbackUrl);

    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: recipients.join(", "),
        subject: email.subject,
        html,
        text,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Close the transporter connection
   */
  close(): void {
    this.transporter.close();
  }

  // === HTML Templates ===

  private renderStatusEmail(email: StatusEmail): string {
    const levelColors: Record<StatusEmail["level"], string> = {
      info: "#2196F3",
      warning: "#FF9800",
      error: "#F44336",
      success: "#4CAF50",
    };

    const levelIcons: Record<StatusEmail["level"], string> = {
      info: "ℹ️",
      warning: "⚠️",
      error: "❌",
      success: "✅",
    };

    const color = levelColors[email.level];
    const icon = levelIcons[email.level];
    const timestamp = new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
    });

    // Simple markdown to HTML conversion for content
    const htmlContent = this.markdownToHtml(email.content);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: white; }
    .header { background: ${color}; color: white; padding: 20px; }
    .header h2 { margin: 0; font-size: 20px; }
    .content { padding: 24px; line-height: 1.6; color: #333; }
    .content p { margin: 0 0 16px 0; }
    .content pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
    .content code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
    .footer { padding: 16px 24px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${icon} ${this.escapeHtml(email.subject)}</h2>
    </div>
    <div class="content">
      ${htmlContent}
    </div>
    <div class="footer">
      Sent by panpan at ${timestamp}
    </div>
  </div>
</body>
</html>`;
  }

  private renderChoiceEmail(
    email: ChoiceEmail,
    token: string,
    callbackUrl: string,
  ): string {
    const timestamp = new Date().toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
    });

    const optionsHtml = email.options
      .map((option) => {
        const url = `${callbackUrl}/choice/${token}/${option.id}`;
        const description = option.description
          ? `<div style="font-size: 13px; opacity: 0.9; margin-top: 4px;">${
            this.escapeHtml(option.description)
          }</div>`
          : "";
        return `
        <a href="${url}"
           style="display: block; padding: 16px 24px; margin: 12px 0;
                  background: #007bff; color: white; text-decoration: none;
                  border-radius: 8px; text-align: center; font-size: 16px;
                  transition: background 0.2s;">
          <strong>${this.escapeHtml(option.label)}</strong>
          ${description}
        </a>`;
      })
      .join("\n");

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: white; }
    .header { background: #2196F3; color: white; padding: 20px; }
    .header h2 { margin: 0; font-size: 20px; }
    .content { padding: 24px; }
    .description { color: #333; line-height: 1.6; margin-bottom: 24px; }
    .options { margin: 24px 0; }
    .footer { padding: 16px 24px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
    .expire-note { color: #f57c00; font-size: 13px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>🤔 ${this.escapeHtml(email.subject)}</h2>
    </div>
    <div class="content">
      <div class="description">
        ${this.markdownToHtml(email.description)}
      </div>
      <div class="options">
        ${optionsHtml}
      </div>
      <p class="expire-note">
        ⏰ This request will expire in ${email.timeoutMinutes} minutes.
      </p>
    </div>
    <div class="footer">
      Sent by panpan at ${timestamp}
    </div>
  </div>
</body>
</html>`;
  }

  private renderChoiceText(
    email: ChoiceEmail,
    token: string,
    callbackUrl: string,
  ): string {
    const options = email.options
      .map((opt) => {
        const url = `${callbackUrl}/choice/${token}/${opt.id}`;
        const desc = opt.description ? ` - ${opt.description}` : "";
        return `- ${opt.label}${desc}\n  Link: ${url}`;
      })
      .join("\n\n");

    return `${email.subject}

${email.description}

Options:
${options}

This request will expire in ${email.timeoutMinutes} minutes.

---
Sent by panpan`;
  }

  // === Helpers ===

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Simple markdown to HTML conversion
   * Supports: paragraphs, code blocks, inline code, bold, italic
   */
  private markdownToHtml(text: string): string {
    // Escape HTML first
    let html = this.escapeHtml(text);

    // Code blocks (```...```)
    html = html.replace(
      /```(\w*)\n([\s\S]*?)```/g,
      "<pre><code>$2</code></pre>",
    );

    // Inline code (`...`)
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold (**...**)
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    // Italic (*...*)
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Paragraphs (double newlines)
    html = html
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
      .join("\n");

    return html;
  }
}
