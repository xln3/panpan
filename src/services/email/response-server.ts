/**
 * HTTP callback server for receiving email choice responses
 *
 * Handles requests when users click option links in emails.
 * Routes: GET /choice/{token}/{optionId}
 */

import { pendingRequestManager } from "./pending-requests.ts";

/**
 * HTTP server for handling email choice callbacks
 */
export class ResponseServer {
  private server: Deno.HttpServer | null = null;
  private port: number;

  constructor(port: number = 8765) {
    this.port = port;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this.server) {
      return; // Already running
    }

    this.server = Deno.serve(
      { port: this.port, onListen: () => {} },
      (request) => this.handleRequest(request),
    );

    // Wait a tick to ensure server is listening
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      this.server = null;
    }
  }

  /**
   * Check if server is running
   */
  get isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Get the port number
   */
  get portNumber(): number {
    return this.port;
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(request: Request): Response {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route: GET /choice/{token}/{optionId}
    const choiceMatch = path.match(/^\/choice\/([^/]+)\/([^/]+)$/);
    if (choiceMatch && request.method === "GET") {
      const [, token, optionId] = choiceMatch;
      return this.handleChoice(token, optionId);
    }

    // Route: GET /health
    if (path === "/health" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 404 for unknown routes
    return new Response("Not Found", { status: 404 });
  }

  /**
   * Handle a choice selection
   */
  private handleChoice(token: string, optionId: string): Response {
    const request = pendingRequestManager.get(token);

    // Invalid token
    if (!request) {
      return this.renderHtml(
        "Request Not Found",
        `
        <div class="error">
          <h2>❌ Request Not Found</h2>
          <p>This request does not exist or has been removed.</p>
        </div>
        `,
      );
    }

    // Already resolved
    if (request.resolved) {
      const selectedOption = request.options.find(
        (o) => o.id === request.selectedOptionId,
      );
      return this.renderHtml(
        "Already Responded",
        `
        <div class="warning">
          <h2>⚠️ Already Responded</h2>
          <p>You have already selected: <strong>${
          this.escapeHtml(selectedOption?.label || "Unknown")
        }</strong></p>
          <p>This request cannot be changed.</p>
        </div>
        `,
      );
    }

    // Expired
    if (Date.now() > request.expiresAt) {
      return this.renderHtml(
        "Request Expired",
        `
        <div class="error">
          <h2>⏰ Request Expired</h2>
          <p>Sorry, this request has expired and can no longer be responded to.</p>
        </div>
        `,
      );
    }

    // Invalid option
    const option = request.options.find((o) => o.id === optionId);
    if (!option) {
      return this.renderHtml(
        "Invalid Option",
        `
        <div class="error">
          <h2>❌ Invalid Option</h2>
          <p>The selected option is not valid for this request.</p>
        </div>
        `,
      );
    }

    // Resolve the request
    const success = pendingRequestManager.resolve(token, optionId);

    if (success) {
      return this.renderHtml(
        "Choice Recorded",
        `
        <div class="success">
          <h2>✅ Choice Recorded</h2>
          <p>You selected: <strong>${this.escapeHtml(option.label)}</strong></p>
          ${
          option.description
            ? `<p class="desc">${this.escapeHtml(option.description)}</p>`
            : ""
        }
          <p class="note">You can close this window now. Panpan will continue with your choice.</p>
        </div>
        `,
      );
    } else {
      return this.renderHtml(
        "Error",
        `
        <div class="error">
          <h2>❌ Error</h2>
          <p>An error occurred while recording your choice. Please try again.</p>
        </div>
        `,
      );
    }
  }

  /**
   * Render an HTML response page
   */
  private renderHtml(title: string, content: string): Response {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${this.escapeHtml(title)} - Panpan</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0; padding: 40px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
    }
    h2 { margin: 0 0 16px 0; font-size: 24px; }
    p { margin: 0 0 12px 0; color: #555; line-height: 1.6; }
    .success h2 { color: #4CAF50; }
    .error h2 { color: #F44336; }
    .warning h2 { color: #FF9800; }
    .desc { font-style: italic; color: #777; }
    .note {
      margin-top: 24px;
      padding: 12px;
      background: #f5f5f5;
      border-radius: 8px;
      font-size: 14px;
      color: #666;
    }
    .logo {
      font-size: 48px;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🐼</div>
    ${content}
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

// Singleton instance
export const responseServer = new ResponseServer();
