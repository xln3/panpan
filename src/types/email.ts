/**
 * Email notification types for panpan
 */

/**
 * SMTP configuration for email sending
 */
export interface SMTPConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** true for SSL (port 465), false for TLS (port 587) */
  secure: boolean;
}

/**
 * Complete email service configuration
 */
export interface EmailConfig {
  smtp: SMTPConfig;
  /** List of recipient email addresses */
  recipients: string[];
  /** Base URL for callback server (e.g., http://your-server:8765) */
  callbackUrl: string;
  /** Port for the callback HTTP server */
  callbackPort: number;
}

/**
 * Status notification email content
 */
export interface StatusEmail {
  subject: string;
  /** Content in plain text or Markdown (will be converted to HTML) */
  content: string;
  /** Visual indicator level */
  level: "info" | "warning" | "error" | "success";
}

/**
 * Choice option for interactive email
 */
export interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * Choice request email content
 */
export interface ChoiceEmail {
  subject: string;
  description: string;
  options: ChoiceOption[];
  /** Timeout in minutes (default: 30) */
  timeoutMinutes: number;
}

/**
 * Pending request state for tracking user responses
 */
export interface PendingRequest {
  /** UUID token for the request */
  id: string;
  options: ChoiceOption[];
  createdAt: number;
  expiresAt: number;
  resolved: boolean;
  selectedOptionId?: string;
}

/**
 * Response from the callback server when user clicks an option
 */
export interface ChoiceResponse {
  token: string;
  optionId: string;
  timestamp: number;
}

/**
 * Result of an email send operation
 */
export interface EmailSendResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

/**
 * Result of a choice email request
 */
export interface ChoiceRequestResult {
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  timedOut: boolean;
}
