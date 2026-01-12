/**
 * WebFetch tool - Playwright-based web content fetcher
 * Uses headless Chromium with stealth mode and auth flow support
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../types/tool.ts";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import {
  BrowserManager,
  isUrlAllowed,
  smartScroll,
} from "../utils/browser-manager.ts";

const inputSchema = z.object({
  url: z.string().url().describe("The URL to fetch content from"),
  prompt: z.string().optional().describe(
    "What information you want to extract from the page (for future use)",
  ),
  jsWaitMs: z
    .number()
    .min(0)
    .max(30000)
    .default(3000)
    .describe("Time to wait for JavaScript to render (ms)"),
  scrollMode: z
    .enum(["none", "smart", "full"])
    .default("smart")
    .describe("Scroll behavior: none, smart (until no new content), or full"),
  maxScrolls: z
    .number()
    .min(0)
    .max(50)
    .default(10)
    .describe("Maximum number of scroll attempts for smart/full mode"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  url: string;
  finalUrl: string;
  status: number;
  title: string;
  content: string;
  truncated: boolean;
  authRequired?: boolean;
}

const MAX_CONTENT_LENGTH = 50000;
const TIMEOUT = 60000; // 60s for Playwright (longer than fetch)

export const WebFetchTool: Tool<typeof inputSchema, Output> = {
  name: "WebFetch",
  description:
    "Fetches content from a URL using a headless browser. Handles JavaScript-rendered pages, lazy loading, and can prompt for manual login when blocked. Use this when you need to retrieve and analyze web content.",
  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => false, // Browser operations should be serialized

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    // Validate URL for security
    const urlCheck = isUrlAllowed(input.url);
    if (!urlCheck.allowed) {
      yield {
        type: "result",
        data: {
          url: input.url,
          finalUrl: input.url,
          status: 0,
          title: "",
          content: "",
          truncated: false,
        },
        resultForAssistant: `URL not allowed: ${urlCheck.reason}`,
      };
      return;
    }

    // Upgrade HTTP to HTTPS
    let url = input.url;
    if (url.startsWith("http://")) {
      url = "https://" + url.slice(7);
    }

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Timeout")), TIMEOUT);
    });

    // Track abort
    let aborted = false;
    const abortHandler = () => {
      aborted = true;
    };
    context.abortController.signal.addEventListener("abort", abortHandler);

    let page:
      | Awaited<ReturnType<typeof BrowserManager.createStealthPage>>["page"]
      | null = null;
    let browserContext:
      | Awaited<ReturnType<typeof BrowserManager.createStealthPage>>["context"]
      | null = null;

    try {
      // Yield progress
      yield { type: "progress", content: `Fetching ${url}...` };

      // Create stealth page
      const result = await Promise.race([
        BrowserManager.createStealthPage(url),
        timeoutPromise,
      ]);
      page = result.page;
      browserContext = result.context;

      if (aborted) {
        throw new Error("Aborted");
      }

      // Navigate to URL - use "commit" for faster initial response
      // then wait for content separately
      const response = await Promise.race([
        page.goto(url, {
          waitUntil: "commit", // Fast initial response
          timeout: TIMEOUT,
        }),
        timeoutPromise,
      ]);

      const responseStatus = response?.status() ?? 0;

      if (aborted) {
        throw new Error("Aborted");
      }

      // Wait for DOM to be ready (with a shorter timeout)
      try {
        await Promise.race([
          page.waitForLoadState("domcontentloaded", { timeout: 15000 }),
          new Promise((resolve) => setTimeout(resolve, 15000)),
        ]);
      } catch {
        // Continue even if DOM doesn't fully load - we can still extract content
      }

      // Simulate human-like behavior to avoid "zero interaction" detection
      await simulateHumanBehavior(page);

      // Wait for JS rendering
      if (input.jsWaitMs > 0) {
        yield {
          type: "progress",
          content: `Waiting ${input.jsWaitMs}ms for JS...`,
        };
        await new Promise((resolve) => setTimeout(resolve, input.jsWaitMs));
      }

      // Check for soft failures (Cloudflare, CAPTCHA, login walls)
      const softFailure = await BrowserManager.detectSoftFailure(
        page,
        responseStatus,
      );

      if (softFailure) {
        yield { type: "progress", content: `Detected: ${softFailure.message}` };

        // Try auth flow
        const authSuccess = await BrowserManager.handleAuthChallenge(
          url,
          softFailure,
          async (message: string) => {
            // Simple prompt - in a real implementation this would use CLI prompt
            console.log(message);
            console.log(
              "Press 'y' + Enter to proceed, or any other key to skip:",
            );
            const buf = new Uint8Array(10);
            await Deno.stdin.read(buf);
            const response = new TextDecoder().decode(buf).trim().toLowerCase();
            return response.startsWith("y");
          },
        );

        if (authSuccess) {
          // Retry with new credentials
          yield {
            type: "progress",
            content: "Retrying with saved credentials...",
          };

          // Close old page/context and create new one with saved storage
          await page.close();
          await browserContext.close();

          const retryResult = await BrowserManager.createStealthPage(url);
          page = retryResult.page;
          browserContext = retryResult.context;

          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: TIMEOUT,
          });

          if (input.jsWaitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, input.jsWaitMs));
          }
        } else {
          // User declined auth - return partial result
          yield {
            type: "result",
            data: {
              url,
              finalUrl: page.url(),
              status: responseStatus,
              title: await page.title(),
              content: `Authentication required: ${softFailure.message}`,
              truncated: false,
              authRequired: true,
            },
            resultForAssistant:
              `Access blocked to ${url}: ${softFailure.message}\nUser declined manual login.`,
          };
          return;
        }
      }

      if (aborted) {
        throw new Error("Aborted");
      }

      // Smart scroll to load lazy content
      if (input.scrollMode !== "none") {
        yield { type: "progress", content: "Scrolling to load content..." };
        await smartScroll(page, input.maxScrolls);
      }

      if (aborted) {
        throw new Error("Aborted");
      }

      // Extract content
      yield { type: "progress", content: "Extracting content..." };

      const html = await page.content();
      const title = await page.title();
      const finalUrl = page.url();

      // Use Readability for clean content extraction
      let content = extractContent(html, finalUrl);
      let truncated = false;

      // Truncate if too long
      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH);
        truncated = true;
      }

      const output: Output = {
        url,
        finalUrl,
        status: responseStatus,
        title,
        content,
        truncated,
      };

      yield {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output),
      };
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);

      if (errorMessage === "Aborted" || aborted) {
        yield {
          type: "result",
          data: {
            url,
            finalUrl: url,
            status: 0,
            title: "",
            content: "",
            truncated: false,
          },
          resultForAssistant: "Request aborted",
        };
        return;
      }

      // Handle specific error types
      let userMessage = `Error fetching ${url}: ${errorMessage}`;

      if (errorMessage === "Timeout") {
        userMessage = `Timeout fetching ${url} after ${TIMEOUT / 1000}s`;
      } else if (errorMessage.includes("net::ERR_NAME_NOT_RESOLVED")) {
        userMessage = `DNS resolution failed for ${url}`;
      } else if (errorMessage.includes("net::ERR_CONNECTION_REFUSED")) {
        userMessage = `Connection refused to ${url}`;
      }

      yield {
        type: "result",
        data: {
          url,
          finalUrl: url,
          status: 0,
          title: "",
          content: "",
          truncated: false,
        },
        resultForAssistant: userMessage,
      };
    } finally {
      context.abortController.signal.removeEventListener("abort", abortHandler);

      // Cleanup
      try {
        if (page) await page.close();
        if (browserContext) await browserContext.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  },

  renderResultForAssistant(output: Output): string {
    if (output.authRequired) {
      return `Access to ${output.url} requires authentication. User declined manual login.`;
    }

    if (output.status >= 400) {
      return `Error fetching ${output.url}: HTTP ${output.status}`;
    }

    if (!output.content) {
      return `No content extracted from ${output.url}`;
    }

    let result = "";

    // Add title if available
    if (output.title) {
      result += `# ${output.title}\n\n`;
    }

    // Add URL if redirected
    if (output.finalUrl !== output.url) {
      result += `(Redirected to: ${output.finalUrl})\n\n`;
    }

    result += output.content;

    if (output.truncated) {
      result += "\n\n(Content truncated)";
    }

    return result;
  },

  renderToolUseMessage(input, { verbose }) {
    const { url, jsWaitMs, scrollMode } = input;

    // Verbose mode: show full details
    if (verbose) {
      const parts = [url];
      if (jsWaitMs !== 3000) parts.push(`wait=${jsWaitMs}ms`);
      if (scrollMode !== "smart") parts.push(`scroll=${scrollMode}`);
      return parts.join(" ");
    }

    // Concise mode: truncate URL
    const urlDisplay = url.length > 60 ? url.slice(0, 57) + "..." : url;
    return urlDisplay;
  },
};

/**
 * Extract readable content from HTML using Readability
 * Falls back to basic extraction if Readability fails
 */
function extractContent(html: string, url: string): string {
  try {
    // Use Readability for clean extraction
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.textContent) {
      // Clean up the text content
      let content = article.textContent;

      // Normalize whitespace
      content = content.replace(/\n{3,}/g, "\n\n");
      content = content.replace(/[ \t]+/g, " ");
      content = content.trim();

      return content;
    }
  } catch {
    // Readability failed, fall back to basic extraction
  }

  // Fallback: basic HTML-to-text conversion
  return basicHtmlToText(html);
}

/**
 * Basic HTML to text conversion (fallback)
 */
function basicHtmlToText(html: string): string {
  // Remove non-content elements first
  let text = html;

  // Remove script, style, nav, header, footer, aside, form, svg, noscript
  const removePatterns = [
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    /<style[^>]*>[\s\S]*?<\/style>/gi,
    /<nav[^>]*>[\s\S]*?<\/nav>/gi,
    /<header[^>]*>[\s\S]*?<\/header>/gi,
    /<footer[^>]*>[\s\S]*?<\/footer>/gi,
    /<aside[^>]*>[\s\S]*?<\/aside>/gi,
    /<form[^>]*>[\s\S]*?<\/form>/gi,
    /<svg[^>]*>[\s\S]*?<\/svg>/gi,
    /<noscript[^>]*>[\s\S]*?<\/noscript>/gi,
    /<button[^>]*>[\s\S]*?<\/button>/gi,
    /<input[^>]*>/gi,
    /<select[^>]*>[\s\S]*?<\/select>/gi,
  ];

  for (const pattern of removePatterns) {
    text = text.replace(pattern, "");
  }

  // Convert common elements
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");
  text = text.replace(/<li[^>]*>/gi, "- ");
  text = text.replace(/<\/li>/gi, "\n");

  // Preserve links as markdown
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, "[$2]($1)");

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&mdash;/g, "—");
  text = text.replace(/&ndash;/g, "–");
  text = text.replace(/&hellip;/g, "…");
  text = text.replace(
    /&#(\d+);/g,
    (_, code) => String.fromCharCode(parseInt(code, 10)),
  );

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+/g, " ");

  // Remove lines that are only whitespace or dashes
  text = text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      // Remove empty lines and lines with only dashes/bullets
      if (!trimmed) return false;
      if (/^[-–—•·]+$/.test(trimmed)) return false;
      if (trimmed === "-") return false;
      return true;
    })
    .join("\n");

  // Final cleanup
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

/**
 * Simulate human-like behavior to avoid bot detection
 * Cloudflare specifically checks for zero mouse events and no scroll
 */
async function simulateHumanBehavior(
  page: Awaited<ReturnType<typeof BrowserManager.createStealthPage>>["page"],
): Promise<void> {
  try {
    const viewport = page.viewportSize();
    if (!viewport) return;

    // Generate random mouse movements (3-5 movements)
    const numMoves = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numMoves; i++) {
      const x = Math.floor(Math.random() * viewport.width * 0.8) +
        viewport.width * 0.1;
      const y = Math.floor(Math.random() * viewport.height * 0.8) +
        viewport.height * 0.1;

      // Move with slight randomization in steps
      await page.mouse.move(x, y, {
        steps: 5 + Math.floor(Math.random() * 10),
      });

      // Random delay between moves (50-200ms)
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
    }

    // Small random scroll (simulates reading)
    const scrollAmount = Math.floor(Math.random() * 300) + 100;
    await page.evaluate((amount: number) => {
      // @ts-ignore - scrollBy exists in browser context
      // deno-lint-ignore no-window
      window.scrollBy({ top: amount, behavior: "smooth" });
    }, scrollAmount);

    // Brief pause
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

    // Scroll back up slightly
    await page.evaluate((amount: number) => {
      // @ts-ignore - scrollBy exists in browser context
      // deno-lint-ignore no-window
      window.scrollBy({ top: -amount / 2, behavior: "smooth" });
    }, scrollAmount);
  } catch {
    // Ignore errors in behavior simulation - it's not critical
  }
}
