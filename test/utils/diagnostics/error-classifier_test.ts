/**
 * Tests for diagnostics module - error classification
 */

import { assertEquals, assertExists } from "@std/assert";
import { classifyError } from "../../../src/utils/diagnostics/error-classifier.ts";

Deno.test("classifyError - identifies timeout errors", async () => {
  const stderrSamples = [
    "ReadTimeoutError: HTTPSConnectionPool - Read timed out",
    "Connection timeout after 30 seconds",
    "read timeout",
    "ConnectTimeoutError: connection timed out",
  ];

  for (const stderr of stderrSamples) {
    const diagnosis = await classifyError(stderr);
    assertEquals(diagnosis.type, "timeout", `Failed for: ${stderr}`);
  }
});

Deno.test("classifyError - identifies DNS errors", async () => {
  const stderrSamples = [
    "Name or service not known",
    "Could not resolve host: example.com",
    "getaddrinfo failed",
    "Temporary failure in name resolution",
  ];

  for (const stderr of stderrSamples) {
    const diagnosis = await classifyError(stderr);
    assertEquals(diagnosis.type, "dns", `Failed for: ${stderr}`);
  }
});

Deno.test("classifyError - identifies SSL errors", async () => {
  const stderrSamples = [
    "SSL: CERTIFICATE_VERIFY_FAILED",
    "certificate verify failed",
    "TLS handshake failed",
    "SSL handshake error",
  ];

  for (const stderr of stderrSamples) {
    const diagnosis = await classifyError(stderr);
    assertEquals(diagnosis.type, "ssl", `Failed for: ${stderr}`);
  }
});

Deno.test("classifyError - identifies permission errors", async () => {
  const stderrSamples = [
    "Permission denied",
    "Access denied",
    "EACCES: permission denied",
    "EPERM: operation not permitted",
  ];

  for (const stderr of stderrSamples) {
    const diagnosis = await classifyError(stderr);
    assertEquals(diagnosis.type, "permission", `Failed for: ${stderr}`);
  }
});

Deno.test("classifyError - identifies disk full errors", async () => {
  const stderrSamples = [
    "No space left on device",
    "disk full",
    "ENOSPC: no space left on device",
  ];

  for (const stderr of stderrSamples) {
    const diagnosis = await classifyError(stderr);
    assertEquals(diagnosis.type, "disk_full", `Failed for: ${stderr}`);
  }
});

Deno.test("classifyError - identifies HTTP errors", async () => {
  const cases: Array<{ stderr: string; expected: "http_error" }> = [
    { stderr: "404 Not Found", expected: "http_error" },
    { stderr: "HTTP 500 Internal Server Error", expected: "http_error" },
    { stderr: "403 Forbidden error", expected: "http_error" },
    { stderr: "status: 502", expected: "http_error" },
  ];

  for (const { stderr, expected } of cases) {
    const diagnosis = await classifyError(stderr);
    assertEquals(diagnosis.type, expected, `Failed for: ${stderr}`);
  }
});

Deno.test("classifyError - returns unknown for unrecognized errors", async () => {
  const diagnosis = await classifyError("Some random error message");
  assertEquals(diagnosis.type, "unknown");
  assertEquals(diagnosis.requiresUserInput, true);
});

Deno.test("classifyError - suggests mirrors for pip timeout", async () => {
  const diagnosis = await classifyError(
    "ReadTimeoutError: HTTPSConnectionPool - Read timed out",
    { tool: "pip" },
  );

  assertEquals(diagnosis.type, "timeout");
  assertEquals(diagnosis.autoFixable, true);

  // Should suggest PyPI mirrors
  const mirrorFix = diagnosis.suggestedFixes.find((f) =>
    f.action.type === "use_mirror"
  );
  assertExists(mirrorFix);
});

Deno.test("classifyError - server errors are auto-fixable", async () => {
  const diagnosis = await classifyError("HTTP 500 Internal Server Error");
  assertEquals(diagnosis.type, "http_error");
  assertEquals(diagnosis.autoFixable, true);
});

Deno.test("classifyError - client errors require user input", async () => {
  const diagnosis = await classifyError("403 Forbidden");
  assertEquals(diagnosis.type, "http_error");
  assertEquals(diagnosis.requiresUserInput, true);
});
