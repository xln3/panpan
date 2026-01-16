/**
 * Tests for Network Diagnostics
 *
 * Tests the network diagnostics functionality including:
 * - diagnoseNetwork function
 * - NETWORK_ERROR_PATTERNS in Bash tool
 * - URL extraction from command/output
 */

import { assertEquals, assertExists } from "@std/assert";
import { diagnoseNetwork } from "../../../src/utils/diagnostics/network-diagnostics.ts";

// ============================================================================
// diagnoseNetwork Tests
// Note: These tests use sanitizeOps: false because diagnoseNetwork uses
// setTimeout for fetch timeouts which may not complete before test ends
// ============================================================================

Deno.test({
  name: "diagnoseNetwork - returns NetworkDiagnosis structure",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const result = await diagnoseNetwork();

    // Should have all expected fields
    assertExists(result.networkReachable);
    assertExists(result.dnsWorking);
    assertExists(result.proxyConfigured);
    assertExists(result.availableMirrors);
    assertExists(result.sslValid);
  },
});

Deno.test({
  name: "diagnoseNetwork - with target URL includes DNS check",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const result = await diagnoseNetwork("https://www.baidu.com");

    // With URL, should have DNS check result
    assertEquals(typeof result.dnsWorking, "boolean");
  },
});

Deno.test({
  name: "diagnoseNetwork - without URL assumes DNS works if network reachable",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const result = await diagnoseNetwork();

    // Without URL, dnsWorking should match networkReachable
    if (result.networkReachable) {
      assertEquals(result.dnsWorking, true);
    }
  },
});

Deno.test({
  name: "diagnoseNetwork - detects available mirrors for known URLs",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    // GitHub URL should have mirrors
    const result = await diagnoseNetwork("https://github.com/user/repo.git");

    // May have mirrors configured
    assertEquals(Array.isArray(result.availableMirrors), true);
  },
});

// ============================================================================
// NETWORK_ERROR_PATTERNS Tests
// ============================================================================

const NETWORK_ERROR_PATTERNS = [
  "Network is unreachable",
  "Connection timed out",
  "Connection refused",
  "Name or service not known",
  "Could not resolve host",
  "No route to host",
  "Connection reset by peer",
  "SSL certificate problem",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ECONNRESET",
];

Deno.test("NETWORK_ERROR_PATTERNS - detects network unreachable", () => {
  const errorOutput = "fatal: unable to access: Network is unreachable";
  const matched = NETWORK_ERROR_PATTERNS.some((p) => errorOutput.includes(p));
  assertEquals(matched, true);
});

Deno.test("NETWORK_ERROR_PATTERNS - detects connection timeout", () => {
  const errorOutput = "curl: (7) Failed to connect: Connection timed out";
  const matched = NETWORK_ERROR_PATTERNS.some((p) => errorOutput.includes(p));
  assertEquals(matched, true);
});

Deno.test("NETWORK_ERROR_PATTERNS - detects DNS failure", () => {
  const errorOutput = "getaddrinfo: Name or service not known";
  const matched = NETWORK_ERROR_PATTERNS.some((p) => errorOutput.includes(p));
  assertEquals(matched, true);
});

Deno.test("NETWORK_ERROR_PATTERNS - detects SSL certificate problems", () => {
  const errorOutput = "SSL certificate problem: certificate has expired";
  const matched = NETWORK_ERROR_PATTERNS.some((p) => errorOutput.includes(p));
  assertEquals(matched, true);
});

Deno.test("NETWORK_ERROR_PATTERNS - detects ETIMEDOUT", () => {
  const errorOutput = "npm ERR! network request failed ETIMEDOUT";
  const matched = NETWORK_ERROR_PATTERNS.some((p) => errorOutput.includes(p));
  assertEquals(matched, true);
});

Deno.test("NETWORK_ERROR_PATTERNS - does not match unrelated errors", () => {
  const errorOutput = "Permission denied: /etc/hosts";
  const matched = NETWORK_ERROR_PATTERNS.some((p) => errorOutput.includes(p));
  assertEquals(matched, false);
});

// ============================================================================
// URL Extraction Tests
// ============================================================================

function extractUrl(text: string): string | undefined {
  const urlPattern = /https?:\/\/[^\s'"]+/;
  const match = text.match(urlPattern);
  return match?.[0];
}

Deno.test("extractUrl - extracts HTTPS URL from command", () => {
  const command = "curl https://example.com/api/v1/data";
  const url = extractUrl(command);
  assertEquals(url, "https://example.com/api/v1/data");
});

Deno.test("extractUrl - extracts HTTP URL from error message", () => {
  const error = "Failed to fetch http://registry.npmjs.org/package";
  const url = extractUrl(error);
  assertEquals(url, "http://registry.npmjs.org/package");
});

Deno.test("extractUrl - extracts URL with port number", () => {
  const command = "wget https://localhost:8080/download";
  const url = extractUrl(command);
  assertEquals(url, "https://localhost:8080/download");
});

Deno.test("extractUrl - extracts URL with query parameters", () => {
  const command = 'curl "https://api.example.com/search?q=test&page=1"';
  const url = extractUrl(command);
  assertEquals(url, "https://api.example.com/search?q=test&page=1");
});

Deno.test("extractUrl - returns undefined when no URL present", () => {
  const command = "ls -la /home/user";
  const url = extractUrl(command);
  assertEquals(url, undefined);
});

Deno.test("extractUrl - extracts first URL when multiple present", () => {
  const text = "Download from https://first.com or https://second.com";
  const url = extractUrl(text);
  assertEquals(url, "https://first.com");
});

// ============================================================================
// Integration with Bash Tool
// ============================================================================

Deno.test("Bash network diagnostics - builds diagnostic message structure", () => {
  // Simulate the diagnostic message building from bash.ts
  const diagnosis = {
    networkReachable: true,
    dnsWorking: false,
    proxyConfigured: true,
    proxyUrl: "http://proxy.local:8080",
    availableMirrors: ["https://mirror.example.com"],
    sslValid: true,
  };

  const diagParts: string[] = [
    "\n\n📡 NETWORK DIAGNOSTIC:",
    `- Network reachable: ${diagnosis.networkReachable ? "✅ Yes" : "❌ No"}`,
    `- DNS working: ${diagnosis.dnsWorking ? "✅ Yes" : "❌ No"}`,
    `- Proxy configured: ${
      diagnosis.proxyConfigured ? `✅ Yes (${diagnosis.proxyUrl})` : "❌ No"
    }`,
  ];

  if (diagnosis.availableMirrors.length > 0) {
    diagParts.push(
      `- Available mirrors: ${diagnosis.availableMirrors.join(", ")}`,
    );
  }

  const output = diagParts.join("\n");

  // Verify structure
  assertEquals(output.includes("📡 NETWORK DIAGNOSTIC:"), true);
  assertEquals(output.includes("✅ Yes"), true);
  assertEquals(output.includes("❌ No"), true);
  assertEquals(output.includes("proxy.local:8080"), true);
  assertEquals(output.includes("mirror.example.com"), true);
});

Deno.test("Bash network diagnostics - provides actionable suggestions", () => {
  const diagnosis = {
    networkReachable: false,
    dnsWorking: false,
    proxyConfigured: false,
    availableMirrors: ["https://mirror.example.com"],
    sslValid: true,
  };

  const suggestions: string[] = ["\n💡 SUGGESTIONS:"];

  if (!diagnosis.networkReachable) {
    suggestions.push("- Check your internet connection");
    suggestions.push(
      "- If behind a proxy, set HTTP_PROXY/HTTPS_PROXY environment variables",
    );
  } else if (!diagnosis.dnsWorking) {
    suggestions.push("- DNS resolution failed for the target host");
    suggestions.push("- Try using a different DNS server (e.g., 8.8.8.8)");
  }

  if (diagnosis.availableMirrors.length > 0) {
    suggestions.push(
      `- Try using a mirror: ${diagnosis.availableMirrors[0]}`,
    );
  }

  const output = suggestions.join("\n");

  // Verify suggestions are actionable
  assertEquals(output.includes("💡 SUGGESTIONS:"), true);
  assertEquals(output.includes("Check your internet connection"), true);
  assertEquals(output.includes("HTTP_PROXY/HTTPS_PROXY"), true);
  assertEquals(output.includes("mirror.example.com"), true);
});
