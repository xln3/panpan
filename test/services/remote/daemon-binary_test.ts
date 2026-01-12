/**
 * Tests for remote module - daemon binary
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  DAEMON_SOURCE,
  DAEMON_VERSION,
  getDenoCheckCommand,
  getDenoInstallCommand,
  getDenoPath,
} from "../../../src/services/remote/daemon-binary.ts";

Deno.test("DAEMON_SOURCE - contains HTTP server code", () => {
  assertStringIncludes(DAEMON_SOURCE, "Deno.serve");
});

Deno.test("DAEMON_SOURCE - contains /health endpoint", () => {
  assertStringIncludes(DAEMON_SOURCE, "/health");
});

Deno.test("DAEMON_SOURCE - contains /exec endpoint", () => {
  assertStringIncludes(DAEMON_SOURCE, "/exec");
});

Deno.test("DAEMON_SOURCE - contains /file/read endpoint", () => {
  assertStringIncludes(DAEMON_SOURCE, "/file/read");
});

Deno.test("DAEMON_SOURCE - contains /file/write endpoint", () => {
  assertStringIncludes(DAEMON_SOURCE, "/file/write");
});

Deno.test("DAEMON_SOURCE - contains /shutdown endpoint", () => {
  assertStringIncludes(DAEMON_SOURCE, "/shutdown");
});

Deno.test("DAEMON_SOURCE - outputs DAEMON_STARTED marker", () => {
  assertStringIncludes(DAEMON_SOURCE, "DAEMON_STARTED:");
});

Deno.test("DAEMON_SOURCE - validates Bearer token", () => {
  assertStringIncludes(DAEMON_SOURCE, "Bearer");
  assertStringIncludes(DAEMON_SOURCE, "Unauthorized");
});

Deno.test("DAEMON_SOURCE - has auto-shutdown timer", () => {
  assertStringIncludes(DAEMON_SOURCE, "shutdownTimer");
  assertStringIncludes(DAEMON_SOURCE, "setInterval");
});

Deno.test("DAEMON_VERSION - is semantic version", () => {
  const parts = DAEMON_VERSION.split(".");
  assertEquals(parts.length, 3);
  assertEquals(parts.every((p) => !isNaN(parseInt(p))), true);
});

Deno.test("getDenoCheckCommand - returns which command", () => {
  const cmd = getDenoCheckCommand();
  assertStringIncludes(cmd, "deno");
  assertStringIncludes(cmd, "DENO_NOT_FOUND");
});

Deno.test("getDenoInstallCommand - returns curl install script", () => {
  const cmd = getDenoInstallCommand();
  assertStringIncludes(cmd, "curl");
  assertStringIncludes(cmd, "deno.land/install");
});

Deno.test("getDenoPath - returns deno binary path", () => {
  const path = getDenoPath();
  assertStringIncludes(path, "deno");
});
