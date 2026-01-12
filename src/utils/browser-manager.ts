/**
 * Browser Manager - Singleton browser lifecycle with auth flow support
 */

import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";
import {
  getPlatformScript,
  getRandomUserAgent,
  getRandomViewport,
  STEALTH_SCRIPT,
} from "./stealth-scripts.ts";

// Storage directory for browser state (cookies, localStorage)
const STORAGE_DIR = `${Deno.env.get("HOME")}/.panpan/browser-storage`;

/**
 * Soft failure types that can be recovered via manual auth
 */
export interface SoftFailure {
  type: "cloudflare" | "login_wall" | "captcha" | "forbidden" | "rate_limit";
  message: string;
}

/**
 * Browser manager singleton
 */
class BrowserManagerImpl {
  private browser: Browser | null = null;
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL = 2000; // 2s between requests

  /**
   * Initialize browser lazily on first use
   */
  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          // Core stealth: disable automation detection
          "--disable-blink-features=AutomationControlled",
          "--disable-features=AutomationControlled",
          "--disable-automation",

          // Disable features that reveal headless/automation
          "--disable-features=IsolateOrigins,site-per-process,TranslateUI",
          "--disable-site-isolation-trials",
          "--disable-features=BlockInsecurePrivateNetworkRequests",
          "--disable-web-security",

          // Hide that this is a fresh/automated browser
          "--disable-default-apps",
          "--disable-component-extensions-with-background-pages",
          "--disable-background-networking",
          "--disable-client-side-phishing-detection",
          "--disable-sync",
          "--no-first-run",
          "--no-default-browser-check",
          "--metrics-recording-only",
          "--password-store=basic",
          "--use-mock-keychain",

          // Process stability (also helps avoid detection via crashes)
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-hang-monitor",
          "--disable-popup-blocking",
          "--disable-prompt-on-repost",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",

          // Window/UI settings
          "--disable-infobars",
          "--window-position=0,0",
          "--hide-scrollbars",
          "--mute-audio",

          // Network
          "--ignore-certificate-errors",
          "--ignore-certificate-errors-spki-list",
          "--enable-features=NetworkService,NetworkServiceInProcess",

          // Media (for fingerprint consistency)
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
        ],
      });

      // Cleanup on process exit
      const cleanup = async () => {
        await this.close();
      };
      globalThis.addEventListener("unload", cleanup);
    }
    return this.browser;
  }

  /**
   * Get storage state path for a domain
   */
  private getStoragePath(domain: string): string {
    // Sanitize domain for filename
    const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `${STORAGE_DIR}/${safeDomain}.json`;
  }

  /**
   * Load storage state for a domain if it exists
   */
  private async loadStorageState(domain: string): Promise<string | undefined> {
    const path = this.getStoragePath(domain);
    try {
      await Deno.stat(path);
      return path;
    } catch {
      return undefined;
    }
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDir(): Promise<void> {
    try {
      await Deno.mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) {
        throw e;
      }
    }
  }

  /**
   * Rate limiting - ensure minimum interval between requests
   */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.MIN_REQUEST_INTERVAL) {
      const waitTime = this.MIN_REQUEST_INTERVAL - elapsed +
        Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Create a stealth-configured page
   */
  async createStealthPage(
    url: string,
  ): Promise<{ page: Page; context: BrowserContext }> {
    await this.throttle();

    const browser = await this.ensureBrowser();
    const domain = new URL(url).hostname;

    // Load existing storage state if available
    const storagePath = await this.loadStorageState(domain);

    // Random UA and viewport
    const userAgent = getRandomUserAgent();
    const viewport = getRandomViewport();

    // Randomize device properties for fingerprint variety
    const deviceScaleFactors = [1, 1.25, 1.5, 2];
    const deviceScaleFactor =
      deviceScaleFactors[Math.floor(Math.random() * deviceScaleFactors.length)];

    // Randomize timezone (should ideally match IP, but variety helps)
    const timezones = [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Phoenix",
      "America/Detroit",
      "America/Indianapolis",
    ];
    const timezoneId = timezones[Math.floor(Math.random() * timezones.length)];

    // Randomize color scheme
    const colorSchemes = ["light", "dark", "no-preference"] as const;
    const colorScheme =
      colorSchemes[Math.floor(Math.random() * colorSchemes.length)];

    // Create context with stealth settings
    const context = await browser.newContext({
      userAgent,
      viewport,
      storageState: storagePath,
      locale: "en-US",
      timezoneId,
      permissions: ["geolocation"],
      colorScheme,
      deviceScaleFactor,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      // Add consistent HTTP headers
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua":
          '"Chromium";v="131", "Google Chrome";v="131", "Not A(Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": userAgent.includes("Macintosh")
          ? '"macOS"'
          : userAgent.includes("Linux")
          ? '"Linux"'
          : '"Windows"',
      },
      // Bypass CSP to allow our stealth scripts
      bypassCSP: true,
    });

    const page = await context.newPage();

    // Apply stealth scripts BEFORE navigation
    await page.addInitScript(STEALTH_SCRIPT);
    await page.addInitScript(getPlatformScript(userAgent));

    return { page, context };
  }

  /**
   * Detect soft failures (CAPTCHA, login walls, Cloudflare)
   */
  async detectSoftFailure(
    page: Page,
    responseStatus?: number,
  ): Promise<SoftFailure | null> {
    // Check response status
    if (responseStatus === 403) {
      return { type: "forbidden", message: "HTTP 403 Forbidden" };
    }
    if (responseStatus === 429) {
      return { type: "rate_limit", message: "HTTP 429 Rate Limited" };
    }

    // Check for Cloudflare challenge
    const title = await page.title();
    if (
      title.includes("Just a moment") ||
      title.includes("Attention Required") ||
      title.includes("Please Wait")
    ) {
      return {
        type: "cloudflare",
        message: `Cloudflare challenge detected: "${title}"`,
      };
    }

    // Check page content for Cloudflare markers
    const cloudflareMarkers = await page
      .locator('[class*="cf-"], [id*="cf-"], [class*="cloudflare"]')
      .count();
    if (cloudflareMarkers > 0) {
      return { type: "cloudflare", message: "Cloudflare protection detected" };
    }

    // Check for login redirect
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/signin") ||
      currentUrl.includes("/auth") ||
      currentUrl.includes("/account/") ||
      currentUrl.includes("sso")
    ) {
      return {
        type: "login_wall",
        message: `Redirected to login: ${currentUrl}`,
      };
    }

    // Check for CAPTCHA elements
    const captchaCount = await page
      .locator(
        '[class*="captcha"], [id*="captcha"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [class*="g-recaptcha"], [class*="h-captcha"]',
      )
      .count();
    if (captchaCount > 0) {
      return { type: "captcha", message: "CAPTCHA detected on page" };
    }

    // Check for common login form indicators on unexpected pages
    const loginFormCount = await page
      .locator(
        'form[action*="login"], form[action*="signin"], input[type="password"]',
      )
      .count();
    if (loginFormCount > 0) {
      // Could be a login wall
      const hasMainContent = await page.locator(
        "article, main, .content, #content",
      ).count();
      if (hasMainContent === 0) {
        return {
          type: "login_wall",
          message: "Login form detected without main content",
        };
      }
    }

    return null;
  }

  /**
   * Handle auth challenge by launching headful browser for manual login
   */
  async handleAuthChallenge(
    url: string,
    failure: SoftFailure,
    promptFn: (message: string) => Promise<boolean>,
  ): Promise<boolean> {
    const domain = new URL(url).hostname;

    // Prompt user
    const shouldProceed = await promptFn(
      `\nAccess to ${domain} is blocked.\n` +
        `Reason: ${failure.message}\n` +
        `Type: ${failure.type}\n\n` +
        `Do you want to log in manually? A browser window will open.`,
    );

    if (!shouldProceed) {
      return false;
    }

    // Launch headful browser for manual interaction
    // Check if we can launch a headed browser (need display on Linux)
    const hasDisplay = Deno.env.get("DISPLAY") ||
      Deno.build.os === "darwin" ||
      Deno.build.os === "windows";

    if (!hasDisplay) {
      console.log(
        "\nNo display available for manual login (headless server).",
      );
      console.log("Skipping manual authentication flow.\n");
      return false;
    }

    console.log("\nLaunching browser for manual login...");
    console.log("Complete the login/CAPTCHA in the browser window.");
    console.log("Press Enter in the terminal when done.\n");

    const headfulBrowser = await chromium.launch({ headless: false });
    const context = await headfulBrowser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: getRandomViewport(),
    });
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });

      // Wait for user input
      await this.waitForUserInput();

      // Save storage state
      await this.ensureStorageDir();
      const storagePath = this.getStoragePath(domain);
      await context.storageState({ path: storagePath });

      console.log(`Session saved for ${domain}`);
      return true;
    } finally {
      await headfulBrowser.close();
    }
  }

  /**
   * Wait for user to press Enter
   */
  private async waitForUserInput(): Promise<void> {
    const buf = new Uint8Array(1024);
    await Deno.stdin.read(buf);
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore errors during cleanup
      }
      this.browser = null;
    }
  }

  /**
   * Check if browser is initialized
   */
  isInitialized(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }
}

// Singleton instance
export const BrowserManager = new BrowserManagerImpl();

/**
 * Smart scroll function - scrolls until no new content loads
 */
export async function smartScroll(
  page: Page,
  maxScrolls: number = 10,
  scrollDelay: number = 500,
): Promise<void> {
  let previousHeight = 0;
  let scrollCount = 0;

  while (scrollCount < maxScrolls) {
    // Get current page height
    const currentHeight = await page.evaluate("document.body.scrollHeight");

    // Check if we've reached the bottom (no new content)
    if (currentHeight === previousHeight) {
      break;
    }

    previousHeight = currentHeight as number;

    // Scroll to bottom
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");

    // Wait for potential lazy-loaded content
    await new Promise((resolve) => setTimeout(resolve, scrollDelay));

    scrollCount++;
  }

  // Scroll back to top
  await page.evaluate("window.scrollTo(0, 0)");
}

/**
 * URL validation for security (SSRF protection)
 */
export function isUrlAllowed(
  url: string,
): { allowed: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    // Block non-http(s) protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        allowed: false,
        reason: `Protocol not allowed: ${parsed.protocol}`,
      };
    }

    const host = parsed.hostname.toLowerCase();

    // Block localhost
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { allowed: false, reason: "Localhost not allowed" };
    }

    // Block private IP ranges
    if (host.startsWith("192.168.") || host.startsWith("10.")) {
      return { allowed: false, reason: "Private IP range not allowed" };
    }

    // Block 172.16.0.0 - 172.31.255.255
    if (host.startsWith("172.")) {
      const secondOctet = parseInt(host.split(".")[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return { allowed: false, reason: "Private IP range not allowed" };
      }
    }

    // Block link-local
    if (host.startsWith("169.254.")) {
      return { allowed: false, reason: "Link-local address not allowed" };
    }

    // Block metadata endpoints (AWS, GCP, Azure)
    if (host === "169.254.169.254" || host === "metadata.google.internal") {
      return { allowed: false, reason: "Cloud metadata endpoint not allowed" };
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: "Invalid URL" };
  }
}
