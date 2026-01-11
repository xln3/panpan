/**
 * Network diagnostics for detecting connectivity issues.
 * Tests network reachability, DNS, SSL, and proxy configuration.
 */

import type { NetworkDiagnosis } from "../../types/diagnostics.ts";
import { detectProxyConfig, getMirrorsForUrl } from "./config-detector.ts";

/**
 * Perform comprehensive network diagnostics
 */
export async function diagnoseNetwork(
  targetUrl?: string
): Promise<NetworkDiagnosis> {
  const results: NetworkDiagnosis = {
    networkReachable: false,
    dnsWorking: false,
    proxyConfigured: false,
    availableMirrors: [],
    sslValid: true,
  };

  // Run checks in parallel where possible
  const [networkReachable, proxyConfig] = await Promise.all([
    checkNetworkReachable(),
    detectProxyConfig(),
  ]);

  results.networkReachable = networkReachable;

  if (proxyConfig) {
    results.proxyConfigured = true;
    results.proxyUrl = proxyConfig;
  }

  // DNS and SSL checks depend on targetUrl
  if (targetUrl) {
    const [dnsWorking, sslValid] = await Promise.all([
      checkDNS(targetUrl),
      targetUrl.startsWith("https://") ? checkSSL(targetUrl) : Promise.resolve(true),
    ]);
    results.dnsWorking = dnsWorking;
    results.sslValid = sslValid;
    results.availableMirrors = getMirrorsForUrl(targetUrl);
  } else {
    results.dnsWorking = results.networkReachable; // Assume DNS works if network is reachable
  }

  return results;
}

/**
 * Check basic network connectivity by testing reliable endpoints
 */
async function checkNetworkReachable(): Promise<boolean> {
  const testUrls = [
    "https://www.baidu.com",
    "https://www.google.com",
    "https://1.1.1.1",
  ];

  for (const url of testUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Check DNS resolution for a URL
 */
async function checkDNS(targetUrl: string): Promise<boolean> {
  try {
    const url = new URL(targetUrl);
    const results = await Deno.resolveDns(url.hostname, "A");
    return results.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check SSL/TLS certificate validity
 */
async function checkSSL(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      // Only return false for SSL-specific errors
      return !(
        msg.includes("certificate") ||
        msg.includes("ssl") ||
        msg.includes("tls")
      );
    }
    return true;
  }
}

// Re-export for convenience
export { detectProxyConfig } from "./config-detector.ts";
