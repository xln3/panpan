/**
 * Email tools module
 *
 * Provides two tools for email-based user interaction:
 * - EmailNotify: Send status notifications (one-way)
 * - EmailAsk: Send choice requests and wait for response
 */

export { EmailAskTool } from "./email-ask.ts";
export { EmailNotifyTool } from "./email-notify.ts";
