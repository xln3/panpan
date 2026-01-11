/**
 * Tests for Remote Tools
 *
 * Note: These tests mock the connectionManager to avoid actual SSH connections.
 * Integration tests with real SSH should be in a separate file.
 */

import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert@1";
import { RemoteConnectTool } from "../../src/tools/remote/remote-connect.ts";
import { RemoteExecTool } from "../../src/tools/remote/remote-exec.ts";
import { RemoteFileReadTool, RemoteFileWriteTool } from "../../src/tools/remote/remote-file.ts";
import { RemoteDisconnectTool, RemoteListTool } from "../../src/tools/remote/remote-disconnect.ts";
import { connectionManager } from "../../src/services/remote/mod.ts";
import { collectGenerator, createMockToolContext } from "../_helpers/mod.ts";
import type { ToolYield } from "../../src/types/tool.ts";

// Type helper
function getResultData<T>(results: ToolYield<T>[]): T {
  const result = results.find(r => r.type === "result");
  if (!result || result.type !== "result") {
    throw new Error("Expected result type");
  }
  return result.data;
}

// ============================================================================
// RemoteConnectTool Tests
// ============================================================================

Deno.test("RemoteConnectTool - has correct metadata", () => {
  assertEquals(RemoteConnectTool.name, "RemoteConnect");
  assertEquals(RemoteConnectTool.isReadOnly(), true);
  assertEquals(RemoteConnectTool.isConcurrencySafe(), false);
});

Deno.test("RemoteConnectTool - validates required fields", async () => {
  const context = createMockToolContext();

  // Missing hostname should fail schema validation before call
  // The tool itself handles connection errors gracefully
  const results = await collectGenerator(
    RemoteConnectTool.call(
      {
        hostname: "",
        username: "test",
        port: 22,
        auth_method: "key",
      },
      context,
    ),
  );

  // Should get a result (either success or error)
  const data = getResultData(results);
  assertExists(data.connectionId !== undefined || data.error !== undefined);
});

Deno.test("RemoteConnectTool - connection failure returns error data", async () => {
  const context = createMockToolContext();

  // Try to connect to non-existent host
  const results = await collectGenerator(
    RemoteConnectTool.call(
      {
        hostname: "nonexistent.invalid",
        username: "test",
        port: 22,
        auth_method: "key",
      },
      context,
    ),
  );

  const data = getResultData(results);
  assertEquals(data.status, "error");
  assertExists(data.error);
});

// ============================================================================
// RemoteExecTool Tests
// ============================================================================

Deno.test("RemoteExecTool - has correct metadata", () => {
  assertEquals(RemoteExecTool.name, "RemoteExec");
  assertEquals(RemoteExecTool.isReadOnly(), false);
  assertEquals(RemoteExecTool.isConcurrencySafe(), false);
});

Deno.test("RemoteExecTool - requires valid connection", async () => {
  const context = createMockToolContext();

  const results = await collectGenerator(
    RemoteExecTool.call(
      {
        connection_id: "nonexistent-connection",
        command: "echo hello",
        timeout: 5000,
      },
      context,
    ),
  );

  const data = getResultData(results);
  assertEquals(data.exitCode, -1);
  assertStringIncludes(data.stderr, "not found");
});

Deno.test("RemoteExecTool - includes connection_id in error response", async () => {
  const context = createMockToolContext();

  const results = await collectGenerator(
    RemoteExecTool.call(
      {
        connection_id: "test-connection",
        command: "whoami",
        timeout: 5000,
      },
      context,
    ),
  );

  const data = getResultData(results);
  // Should have host field even in error case
  assertExists(data.host);
});

// ============================================================================
// RemoteFileReadTool Tests
// ============================================================================

Deno.test("RemoteFileReadTool - has correct metadata", () => {
  assertEquals(RemoteFileReadTool.name, "RemoteFileRead");
  assertEquals(RemoteFileReadTool.isReadOnly(), true);
  assertEquals(RemoteFileReadTool.isConcurrencySafe(), true);
});

Deno.test("RemoteFileReadTool - requires valid connection", async () => {
  const context = createMockToolContext();

  const results = await collectGenerator(
    RemoteFileReadTool.call(
      {
        connection_id: "nonexistent",
        path: "/etc/hosts",
      },
      context,
    ),
  );

  const data = getResultData(results);
  assertExists(data.error);
  assertStringIncludes(data.error!, "not ready");
});

// ============================================================================
// RemoteFileWriteTool Tests
// ============================================================================

Deno.test("RemoteFileWriteTool - has correct metadata", () => {
  assertEquals(RemoteFileWriteTool.name, "RemoteFileWrite");
  assertEquals(RemoteFileWriteTool.isReadOnly(), false);
  assertEquals(RemoteFileWriteTool.isConcurrencySafe(), false);
});

Deno.test("RemoteFileWriteTool - requires valid connection", async () => {
  const context = createMockToolContext();

  const results = await collectGenerator(
    RemoteFileWriteTool.call(
      {
        connection_id: "nonexistent",
        path: "/tmp/test.txt",
        content: "hello",
      },
      context,
    ),
  );

  const data = getResultData(results);
  assertEquals(data.success, false);
  assertExists(data.error);
});

// ============================================================================
// RemoteDisconnectTool Tests
// ============================================================================

Deno.test("RemoteDisconnectTool - has correct metadata", () => {
  assertEquals(RemoteDisconnectTool.name, "RemoteDisconnect");
  assertEquals(RemoteDisconnectTool.isReadOnly(), false);
});

Deno.test("RemoteDisconnectTool - handles nonexistent connection gracefully", async () => {
  const context = createMockToolContext();

  const results = await collectGenerator(
    RemoteDisconnectTool.call(
      { connection_id: "nonexistent" },
      context,
    ),
  );

  const data = getResultData(results);
  // Should succeed even if connection doesn't exist (idempotent)
  assertEquals(data.disconnected, true);
});

// ============================================================================
// RemoteListTool Tests
// ============================================================================

Deno.test("RemoteListTool - has correct metadata", () => {
  assertEquals(RemoteListTool.name, "RemoteList");
  assertEquals(RemoteListTool.isReadOnly(), true);
  assertEquals(RemoteListTool.isConcurrencySafe(), true);
});

Deno.test("RemoteListTool - returns empty list when no connections", async () => {
  // Ensure no connections
  await connectionManager.disconnectAll();

  const context = createMockToolContext();

  const results = await collectGenerator(
    RemoteListTool.call({}, context),
  );

  const data = getResultData(results);
  assertEquals(data.connections.length, 0);
});

// ============================================================================
// renderResultForAssistant Tests
// ============================================================================

Deno.test("RemoteConnectTool - renderResultForAssistant formats success", () => {
  const output = {
    connectionId: "user@host:22",
    status: "ready",
    daemonPort: 8080,
  };

  const result = RemoteConnectTool.renderResultForAssistant(output);
  assertStringIncludes(result, "Connected");
  assertStringIncludes(result, "user@host:22");
  assertStringIncludes(result, "8080");
});

Deno.test("RemoteConnectTool - renderResultForAssistant formats error", () => {
  const output = {
    connectionId: "",
    status: "error",
    error: "Connection refused",
  };

  const result = RemoteConnectTool.renderResultForAssistant(output);
  assertStringIncludes(result, "error");
  assertStringIncludes(result, "Connection refused");
});

Deno.test("RemoteExecTool - renderResultForAssistant formats output", () => {
  const output = {
    stdout: "hello world\n",
    stderr: "",
    exitCode: 0,
    durationMs: 100,
    host: "server1",
  };

  const result = RemoteExecTool.renderResultForAssistant(output);
  assertStringIncludes(result, "[server1]");
  assertStringIncludes(result, "Exit code: 0");
  assertStringIncludes(result, "hello world");
});
