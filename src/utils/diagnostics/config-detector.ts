/**
 * Configuration detection utilities for proxies and mirrors.
 * Detects proxy settings from various sources and provides mirror lists.
 */

/**
 * Detect proxy configuration from multiple sources.
 * Checks environment variables, git config, curlrc, and pip config.
 */
export async function detectProxyConfig(): Promise<string | undefined> {
  const sources = [
    // 1. Environment variables (highest priority)
    () => Promise.resolve(Deno.env.get("HTTP_PROXY")),
    () => Promise.resolve(Deno.env.get("HTTPS_PROXY")),
    () => Promise.resolve(Deno.env.get("ALL_PROXY")),
    () => Promise.resolve(Deno.env.get("http_proxy")),
    () => Promise.resolve(Deno.env.get("https_proxy")),
    () => Promise.resolve(Deno.env.get("all_proxy")),

    // 2. Git config
    () => parseGitConfig("http.proxy"),
    () => parseGitConfig("https.proxy"),

    // 3. curlrc
    () => parseCurlrc(),

    // 4. pip config
    () => parsePipConfig(),
  ];

  for (const source of sources) {
    try {
      const proxy = await source();
      if (proxy && isValidProxyUrl(proxy)) {
        return proxy;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

/**
 * Parse git config for a specific key
 */
async function parseGitConfig(key: string): Promise<string | undefined> {
  try {
    const command = new Deno.Command("git", {
      args: ["config", "--global", key],
      stdout: "piped",
      stderr: "null",
    });
    const { success, stdout } = await command.output();
    if (success) {
      const value = new TextDecoder().decode(stdout).trim();
      return value || undefined;
    }
  } catch {
    // Git not available
  }
  return undefined;
}

/**
 * Parse ~/.curlrc for proxy setting
 */
async function parseCurlrc(): Promise<string | undefined> {
  try {
    const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
    if (!home) return undefined;

    const curlrcPath = `${home}/.curlrc`;
    const content = await Deno.readTextFile(curlrcPath);

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("proxy=") || trimmed.startsWith("proxy ")) {
        const proxy = trimmed.replace(/^proxy[= ]/, "").trim();
        return proxy || undefined;
      }
    }
  } catch {
    // File doesn't exist
  }
  return undefined;
}

/**
 * Parse pip config for proxy setting
 */
async function parsePipConfig(): Promise<string | undefined> {
  try {
    const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
    if (!home) return undefined;

    const pipConfPaths = [
      `${home}/.pip/pip.conf`,
      `${home}/.config/pip/pip.conf`,
      `${home}/pip/pip.ini`,
    ];

    for (const path of pipConfPaths) {
      try {
        const content = await Deno.readTextFile(path);
        const match = content.match(/proxy\s*=\s*(.+)/i);
        if (match) {
          return match[1].trim();
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Config doesn't exist
  }
  return undefined;
}

/**
 * Validate proxy URL format
 */
function isValidProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "socks5:", "socks4:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Known mirrors for common services
 */
const MIRRORS: Record<string, string[]> = {
  pypi: [
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://mirrors.aliyun.com/pypi/simple",
    "https://pypi.mirrors.ustc.edu.cn/simple",
  ],
  huggingface: [
    "https://hf-mirror.com",
  ],
  npm: [
    "https://registry.npmmirror.com",
  ],
  github: [
    "https://ghproxy.com",
    "https://mirror.ghproxy.com",
  ],
};

/**
 * Get mirror list for a service
 */
export function getMirrors(
  service: "pypi" | "huggingface" | "npm" | "github",
): string[] {
  return MIRRORS[service] || [];
}

/**
 * Get mirrors for a URL based on hostname
 */
export function getMirrorsForUrl(url: string): string[] {
  try {
    const hostname = new URL(url).hostname;
    const mirrorMap: Record<string, string[]> = {
      "pypi.org": MIRRORS.pypi,
      "files.pythonhosted.org": MIRRORS.pypi,
      "huggingface.co": MIRRORS.huggingface,
      "registry.npmjs.org": MIRRORS.npm,
      "github.com": MIRRORS.github,
    };
    return mirrorMap[hostname] || [];
  } catch {
    return [];
  }
}

/**
 * Get environment variables for using a pip mirror
 */
export function getPipMirrorEnv(mirrorUrl: string): Record<string, string> {
  return {
    PIP_INDEX_URL: mirrorUrl,
    PIP_TRUSTED_HOST: new URL(mirrorUrl).hostname,
  };
}

/**
 * Get environment variables for using a uv mirror
 */
export function getUvMirrorEnv(mirrorUrl: string): Record<string, string> {
  return {
    UV_INDEX_URL: mirrorUrl,
  };
}
