/**
 * Advanced stealth scripts for bot detection evasion
 * Applied via page.addInitScript() BEFORE any navigation
 */

/**
 * Main stealth script to inject into pages
 * Mocks browser properties that headless browsers typically expose
 */
export const STEALTH_SCRIPT = `
  // ============================================================
  // CLEANUP: Remove automation-specific globals FIRST
  // ============================================================

  // Playwright/Puppeteer/Selenium detection variables
  delete window.__playwright;
  delete window.__puppeteer_evaluation_script__;
  delete window.__selenium_unwrapped;
  delete window.__webdriver_script_fn;
  delete window.__driver_unwrapped;
  delete window.__webdriver_unwrapped;
  delete window.__driver_evaluate;
  delete window.__webdriver_evaluate;
  delete window.__fxdriver_evaluate;
  delete window.__fxdriver_unwrapped;
  delete window._Selenium_IDE_Recorder;
  delete window._selenium;
  delete window.calledSelenium;
  delete window.domAutomation;
  delete window.domAutomationController;
  delete document.__webdriver_script_fn;
  delete document.$cdc_asdjflasutopfhvcZLmcfl_;
  delete document.$chrome_asyncScriptInfo;

  // CDP (Chrome DevTools Protocol) detection variables
  const cdcProps = Object.getOwnPropertyNames(window).filter(p => p.match(/^cdc_|^\\$cdc_/));
  cdcProps.forEach(prop => { try { delete window[prop]; } catch(e) {} });
  const cdcDocProps = Object.getOwnPropertyNames(document).filter(p => p.match(/^cdc_|^\\$cdc_/));
  cdcDocProps.forEach(prop => { try { delete document[prop]; } catch(e) {} });

  // ============================================================
  // 1. Remove webdriver flag (most basic check)
  // ============================================================
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,  // undefined is more realistic than false
    configurable: true
  });

  // 2. Mock navigator.plugins (headless Chrome has empty plugins array)
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        {
          name: 'Chrome PDF Plugin',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
          length: 1,
          item: () => ({ type: 'application/pdf' }),
          namedItem: () => ({ type: 'application/pdf' }),
          [Symbol.iterator]: function* () { yield { type: 'application/pdf' }; }
        },
        {
          name: 'Chrome PDF Viewer',
          filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
          description: '',
          length: 1,
          item: () => ({ type: 'application/pdf' }),
          namedItem: () => ({ type: 'application/pdf' }),
          [Symbol.iterator]: function* () { yield { type: 'application/pdf' }; }
        },
        {
          name: 'Native Client',
          filename: 'internal-nacl-plugin',
          description: '',
          length: 2,
          item: () => null,
          namedItem: () => null,
          [Symbol.iterator]: function* () {}
        }
      ];
      plugins.item = (i) => plugins[i] || null;
      plugins.namedItem = (name) => plugins.find(p => p.name === name) || null;
      plugins.refresh = () => {};
      plugins.length = plugins.length;
      return plugins;
    },
    configurable: true
  });

  // 3. Mock navigator.mimeTypes
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => {
      const mimeTypes = [
        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' }
      ];
      mimeTypes.item = (i) => mimeTypes[i] || null;
      mimeTypes.namedItem = (type) => mimeTypes.find(m => m.type === type) || null;
      mimeTypes.length = mimeTypes.length;
      return mimeTypes;
    },
    configurable: true
  });

  // 4. Mock window.chrome (missing in headless mode)
  if (!window.chrome) {
    window.chrome = {};
  }
  window.chrome.runtime = window.chrome.runtime || {
    onMessage: {
      addListener: () => {},
      removeListener: () => {},
      hasListener: () => false,
      hasListeners: () => false
    },
    onConnect: {
      addListener: () => {},
      removeListener: () => {},
      hasListener: () => false,
      hasListeners: () => false
    },
    sendMessage: () => {},
    connect: () => ({
      onMessage: { addListener: () => {}, removeListener: () => {} },
      onDisconnect: { addListener: () => {}, removeListener: () => {} },
      postMessage: () => {},
      disconnect: () => {}
    }),
    id: undefined,
    getURL: (path) => '',
    getManifest: () => ({})
  };
  window.chrome.loadTimes = window.chrome.loadTimes || (() => ({
    commitLoadTime: Date.now() / 1000,
    connectionInfo: 'http/1.1',
    finishDocumentLoadTime: Date.now() / 1000,
    finishLoadTime: Date.now() / 1000,
    firstPaintAfterLoadTime: 0,
    firstPaintTime: Date.now() / 1000,
    navigationType: 'Other',
    npnNegotiatedProtocol: 'http/1.1',
    requestTime: Date.now() / 1000,
    startLoadTime: Date.now() / 1000,
    wasAlternateProtocolAvailable: false,
    wasFetchedViaSpdy: false,
    wasNpnNegotiated: false
  }));
  window.chrome.csi = window.chrome.csi || (() => ({
    onloadT: Date.now(),
    pageT: Date.now(),
    startE: Date.now(),
    tran: 15
  }));

  // 4b. Mock window.chrome.app (CRITICAL: missing in headless, major detection vector)
  window.chrome.app = window.chrome.app || {
    isInstalled: false,
    InstallState: {
      DISABLED: 'disabled',
      INSTALLED: 'installed',
      NOT_INSTALLED: 'not_installed'
    },
    RunningState: {
      CANNOT_RUN: 'cannot_run',
      READY_TO_RUN: 'ready_to_run',
      RUNNING: 'running'
    },
    getDetails: () => null,
    getIsInstalled: () => false,
    installState: (callback) => callback ? callback('not_installed') : 'not_installed',
    runningState: () => 'cannot_run'
  };

  // 4c. Fix window dimensions (CRITICAL: headless returns 0 for outer dimensions)
  if (window.outerWidth === 0) {
    Object.defineProperty(window, 'outerWidth', {
      get: () => window.innerWidth,
      configurable: true
    });
  }
  if (window.outerHeight === 0) {
    Object.defineProperty(window, 'outerHeight', {
      get: () => window.innerHeight + 85,  // Browser chrome height
      configurable: true
    });
  }
  // Fix screen dimensions to be consistent
  if (window.screen) {
    const screenWidth = window.screen.width || 1920;
    const screenHeight = window.screen.height || 1080;
    Object.defineProperty(window.screen, 'availWidth', {
      get: () => screenWidth,
      configurable: true
    });
    Object.defineProperty(window.screen, 'availHeight', {
      get: () => screenHeight - 40,  // Taskbar height
      configurable: true
    });
    Object.defineProperty(window.screen, 'availLeft', {
      get: () => 0,
      configurable: true
    });
    Object.defineProperty(window.screen, 'availTop', {
      get: () => 0,
      configurable: true
    });
  }

  // 4d. Mock navigator.connection (Network Information API)
  if (!navigator.connection) {
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        rtt: 50,
        downlink: 10,
        saveData: false,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true
      }),
      configurable: true
    });
  }

  // 4e. Mock navigator.getBattery (some detection uses this)
  if (!navigator.getBattery) {
    navigator.getBattery = () => Promise.resolve({
      charging: true,
      chargingTime: 0,
      dischargingTime: Infinity,
      level: 1,
      onchargingchange: null,
      onchargingtimechange: null,
      ondischargingtimechange: null,
      onlevelchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true
    });
  }

  // 5. Mock permissions API to return realistic values
  const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
  if (originalQuery) {
    navigator.permissions.query = (parameters) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return originalQuery(parameters).catch(() => ({ state: 'prompt', onchange: null }));
    };
  }

  // 6. WebGL fingerprint variation (return consistent but realistic values)
  const getParameterProxyHandler = {
    apply: function(target, thisArg, args) {
      const param = args[0];
      const result = Reflect.apply(target, thisArg, args);
      // UNMASKED_VENDOR_WEBGL
      if (param === 37445) return 'Google Inc. (NVIDIA)';
      // UNMASKED_RENDERER_WEBGL
      if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return result;
    }
  };

  // Apply WebGL modifications when context is created
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const context = originalGetContext.apply(this, [type, ...args]);
    if (context && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
      if (context.getParameter && !context.__stealthPatched) {
        context.getParameter = new Proxy(context.getParameter.bind(context), getParameterProxyHandler);
        context.__stealthPatched = true;
      }
    }
    return context;
  };

  // 7. Mock navigator.languages with common value
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true
  });

  // 8. Mock navigator.platform (consistent with user agent)
  // Will be overridden per-request based on UA

  // 9. Fake screen properties for consistency
  Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });

  // 10. Mock navigator.hardwareConcurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true
  });

  // 11. Mock navigator.deviceMemory
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true
  });

  // 12. Hide automation-related properties
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

  // 13. Mock Notification.permission if not set
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    // Leave as default, this is normal
  }

  // 14. Console log trap (some sites check if console is modified)
  // Keep original console behavior
`;

/**
 * Platform-specific overrides based on User-Agent
 */
export function getPlatformScript(userAgent: string): string {
  let platform = "Win32";
  let appVersion = "5.0 (Windows NT 10.0; Win64; x64)";

  if (userAgent.includes("Macintosh")) {
    platform = "MacIntel";
    appVersion = "5.0 (Macintosh; Intel Mac OS X 10_15_7)";
  } else if (userAgent.includes("Linux")) {
    platform = "Linux x86_64";
    appVersion = "5.0 (X11; Linux x86_64)";
  }

  return `
    Object.defineProperty(navigator, 'platform', {
      get: () => '${platform}',
      configurable: true
    });
    Object.defineProperty(navigator, 'appVersion', {
      get: () => '${appVersion}',
      configurable: true
    });
  `;
}

/**
 * User-Agent pool for rotation
 * These are real Chrome user agents from recent versions
 */
export const USER_AGENTS = [
  // Windows Chrome
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  // macOS Chrome
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // Linux Chrome
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
];

/**
 * Viewport sizes for randomization (common desktop resolutions)
 */
export const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
];

/**
 * Get random User-Agent
 */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Get random viewport
 */
export function getRandomViewport(): { width: number; height: number } {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}
