# WebFetch Tool Documentation

## Overview

WebFetch is a Playwright-based web content fetcher that uses a headless Chromium browser with comprehensive stealth measures to bypass bot detection systems like Cloudflare. It handles JavaScript-rendered pages, lazy loading, and can prompt for manual login when blocked.

## Usage

```typescript
import { WebFetchTool } from "./src/tools/web-fetch.ts";

const result = await WebFetchTool.call({
  url: "https://example.com",
  prompt: "Extract the main content",  // Optional: for future LLM extraction
  jsWaitMs: 3000,                       // Wait for JS rendering (default: 3000)
  scrollMode: "smart",                  // none | smart | full (default: smart)
  maxScrolls: 10,                       // Max scroll attempts (default: 10)
}, context);
```

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | The URL to fetch content from |
| `prompt` | string | optional | What information to extract (for future use) |
| `jsWaitMs` | number | 3000 | Time to wait for JavaScript rendering (0-30000ms) |
| `scrollMode` | enum | "smart" | Scroll behavior: `none`, `smart`, or `full` |
| `maxScrolls` | number | 10 | Maximum scroll attempts for smart/full mode (0-50) |

## Output

```typescript
interface Output {
  url: string;          // Original requested URL
  finalUrl: string;     // Final URL after redirects
  status: number;       // HTTP status code
  title: string;        // Page title
  content: string;      // Extracted text content
  truncated: boolean;   // True if content was truncated (>50KB)
  authRequired?: boolean; // True if blocked by auth/CAPTCHA
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        WebFetchTool                              │
│  src/tools/web-fetch.ts                                         │
├─────────────────────────────────────────────────────────────────┤
│  1. URL Validation (SSRF protection)                            │
│  2. HTTP → HTTPS upgrade                                         │
│  3. Browser page creation (via BrowserManager)                   │
│  4. Navigation with two-stage loading                           │
│  5. Human behavior simulation                                    │
│  6. Soft failure detection (Cloudflare, CAPTCHA, login walls)   │
│  7. Content extraction (Readability + fallback)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BrowserManager                              │
│  src/utils/browser-manager.ts                                   │
├─────────────────────────────────────────────────────────────────┤
│  - Singleton browser lifecycle                                   │
│  - Stealth page creation with randomized fingerprints           │
│  - Rate limiting (2s between requests)                          │
│  - Storage state persistence (cookies/localStorage)             │
│  - Soft failure detection                                        │
│  - Manual auth flow handling                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Stealth Scripts                             │
│  src/utils/stealth-scripts.ts                                   │
├─────────────────────────────────────────────────────────────────┤
│  - CDP/automation globals cleanup                                │
│  - navigator.webdriver evasion                                   │
│  - Browser fingerprint mocking                                   │
│  - Window dimension fixes                                        │
│  - API mocking (connection, battery, permissions)               │
└─────────────────────────────────────────────────────────────────┘
```

## Stealth Implementation

### 1. Browser Launch Configuration

The browser is launched with 35+ stealth arguments:

```typescript
// Key stealth args in browser-manager.ts
args: [
  // Disable automation detection
  "--disable-blink-features=AutomationControlled",
  "--disable-features=AutomationControlled",
  "--disable-automation",

  // Hide fresh/automated browser signals
  "--disable-default-apps",
  "--disable-sync",
  "--no-first-run",
  "--metrics-recording-only",

  // Fingerprint consistency
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",

  // ... and more
]
```

### 2. Context Randomization

Each request creates a context with randomized properties:

| Property | Randomization |
|----------|---------------|
| User-Agent | Pool of 7 Chrome UAs (Windows/Mac/Linux) |
| Viewport | 6 common resolutions (1920x1080, 1366x768, etc.) |
| deviceScaleFactor | [1, 1.25, 1.5, 2] |
| timezoneId | 7 US timezones |
| colorScheme | light, dark, no-preference |

### 3. Stealth Scripts (Injected Before Navigation)

Scripts injected via `page.addInitScript()` to evade detection:

#### CDP/Automation Cleanup
```javascript
// Remove Playwright/Puppeteer/Selenium traces
delete window.__playwright;
delete window.__puppeteer_evaluation_script__;
delete document.$cdc_asdjflasutopfhvcZLmcfl_;
// ... and 20+ more variables
```

#### Navigator Properties
```javascript
// webdriver (undefined is more realistic than false)
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined
});

// plugins (empty in headless, mocked to look real)
Object.defineProperty(navigator, 'plugins', {
  get: () => [/* Chrome PDF Plugin, etc. */]
});

// connection (Network Information API)
Object.defineProperty(navigator, 'connection', {
  get: () => ({
    effectiveType: '4g',
    rtt: 50,
    downlink: 10,
    saveData: false
  })
});
```

#### Window Dimensions (Critical for Headless Detection)
```javascript
// Headless returns 0 for outer dimensions
if (window.outerWidth === 0) {
  Object.defineProperty(window, 'outerWidth', {
    get: () => window.innerWidth
  });
}
if (window.outerHeight === 0) {
  Object.defineProperty(window, 'outerHeight', {
    get: () => window.innerHeight + 85  // Browser chrome
  });
}
```

#### Chrome Object Mocking
```javascript
// chrome.app (missing in headless)
window.chrome.app = {
  isInstalled: false,
  InstallState: { DISABLED: 'disabled', ... },
  RunningState: { CANNOT_RUN: 'cannot_run', ... },
  getDetails: () => null,
  // ...
};
```

### 4. Human Behavior Simulation

After page load, the tool simulates human-like behavior:

```typescript
async function simulateHumanBehavior(page) {
  // Random mouse movements (3-5 moves)
  for (let i = 0; i < numMoves; i++) {
    await page.mouse.move(x, y, { steps: 5-15 });
    await delay(50-200ms);
  }

  // Small random scroll
  await page.evaluate(() => {
    window.scrollBy({ top: 100-400, behavior: "smooth" });
  });

  // Scroll back up slightly
  await page.evaluate(() => {
    window.scrollBy({ top: -halfAmount, behavior: "smooth" });
  });
}
```

### 5. Two-Stage Navigation

To handle slow-loading pages without timing out:

```typescript
// Stage 1: Fast initial response
const response = await page.goto(url, {
  waitUntil: "commit",  // Returns as soon as response received
  timeout: 60000,
});

// Stage 2: Wait for DOM (with shorter timeout)
try {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
} catch {
  // Continue anyway - we can still extract partial content
}
```

## Soft Failure Detection

The tool detects and handles various blocking scenarios:

| Type | Detection Method |
|------|------------------|
| Cloudflare | Title contains "Just a moment", "Attention Required", or page has `.cf-*` elements |
| Login Wall | URL contains `/login`, `/signin`, `/auth`, or page has login form without main content |
| CAPTCHA | Page contains `[class*="captcha"]`, `iframe[src*="recaptcha"]`, etc. |
| Rate Limit | HTTP 429 response |
| Forbidden | HTTP 403 response |

When detected, the tool can prompt for manual login (if display available):
1. Launches headful browser
2. User completes login/CAPTCHA manually
3. Storage state saved for domain
4. Subsequent requests use saved credentials

## Content Extraction

### Primary: Mozilla Readability
```typescript
const dom = new JSDOM(html, { url });
const reader = new Readability(dom.window.document);
const article = reader.parse();
```

### Fallback: Basic HTML-to-Text
If Readability fails, a regex-based extractor:
- Removes script, style, nav, header, footer, aside, form, svg
- Converts common elements (br, p, div, h1-h6, li)
- Preserves links as markdown
- Decodes HTML entities
- Normalizes whitespace

## Security

### SSRF Protection
URLs are validated before fetching:
- Only `http:` and `https:` protocols allowed
- Localhost blocked (127.0.0.1, ::1, localhost)
- Private IP ranges blocked (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
- Link-local blocked (169.254.x.x)
- Cloud metadata endpoints blocked (169.254.169.254, metadata.google.internal)

### Content Limits
- Max content length: 50,000 characters (truncated if exceeded)
- Overall timeout: 60 seconds

## Rate Limiting

Built-in throttling prevents aggressive requests:
- Minimum 2 seconds between requests
- Additional random delay (0-1 second) added

## Storage

Browser state (cookies, localStorage) persisted per domain:
```
~/.panpan/browser-storage/{domain}.json
```

This allows:
- Session persistence across requests
- Saved login credentials
- Cookie-based authentication

## Error Handling

| Error | Response |
|-------|----------|
| Timeout | "Timeout fetching {url} after 60s" |
| DNS failure | "DNS resolution failed for {url}" |
| Connection refused | "Connection refused to {url}" |
| Aborted | "Request aborted" |
| Auth required | "Access blocked to {url}: {reason}. User declined manual login." |

## Dependencies

- `playwright` - Browser automation
- `@mozilla/readability` - Content extraction
- `jsdom` - DOM parsing
- `zod` - Input validation

## Files

| File | Purpose |
|------|---------|
| `src/tools/web-fetch.ts` | Main tool implementation |
| `src/utils/browser-manager.ts` | Browser lifecycle, stealth page creation |
| `src/utils/stealth-scripts.ts` | JavaScript stealth patches |
