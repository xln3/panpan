/**
 * Integration tests for SSH Bootstrap with real server
 *
 * These tests require a real SSH server.
 * Set the following environment variables to run:
 * - TEST_SSH_HOST: hostname
 * - TEST_SSH_PORT: port (default: 22)
 * - TEST_SSH_USER: username
 * - TEST_SSH_PASSWORD: password
 *
 * To run: TEST_SSH_HOST=... TEST_SSH_PORT=... TEST_SSH_USER=... TEST_SSH_PASSWORD=... deno test test/services/remote/ssh-bootstrap-integration_test.ts
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  bootstrapDaemon,
  killRemoteDaemon,
} from "../../../src/services/remote/ssh-bootstrap.ts";
import type { RemoteHost } from "../../../src/types/remote.ts";

// Check if integration test env vars are set
const TEST_SSH_HOST = Deno.env.get("TEST_SSH_HOST");
const TEST_SSH_PORT = parseInt(Deno.env.get("TEST_SSH_PORT") || "22");
const TEST_SSH_USER = Deno.env.get("TEST_SSH_USER");
const TEST_SSH_PASSWORD = Deno.env.get("TEST_SSH_PASSWORD");

const canRunIntegrationTests = TEST_SSH_HOST && TEST_SSH_USER &&
  TEST_SSH_PASSWORD;

// Only run these tests if env vars are set
if (canRunIntegrationTests) {
  const testHost: RemoteHost = {
    id: "integration-test",
    hostname: TEST_SSH_HOST!,
    port: TEST_SSH_PORT,
    username: TEST_SSH_USER!,
    authMethod: "password",
    password: TEST_SSH_PASSWORD!,
  };

  Deno.test({
    name: "Integration - SSH_ASKPASS password auth connects successfully",
    ignore: !canRunIntegrationTests,
    async fn() {
      const result = await bootstrapDaemon(testHost, {
        sshTimeout: 30,
        daemonTimeout: 60, // Short timeout for testing
      });

      if (!result.success) {
        console.error("Bootstrap failed:", result.error);
      }

      assertEquals(
        result.success,
        true,
        `Expected success but got error: ${result.error}`,
      );
      assertExists(result.daemonInfo, "Should have daemon info");
      assertExists(result.daemonInfo!.port, "Should have daemon port");
      assertExists(result.daemonInfo!.pid, "Should have daemon PID");

      // Cleanup - kill the daemon
      if (result.daemonInfo?.pid) {
        await killRemoteDaemon(testHost, result.daemonInfo.pid);
      }
    },
  });

  Deno.test({
    name: "Integration - SSH_ASKPASS rejects wrong password",
    ignore: !canRunIntegrationTests,
    async fn() {
      const badHost: RemoteHost = {
        ...testHost,
        password: "wrong-password-12345",
      };

      const result = await bootstrapDaemon(badHost, {
        sshTimeout: 10,
      });

      assertEquals(result.success, false, "Should fail with wrong password");
      assertExists(result.error);
    },
  });
} else {
  // Placeholder test when env vars not set
  Deno.test("Integration tests skipped - set TEST_SSH_* env vars to run", () => {
    console.log(
      "Skipping SSH integration tests. Set environment variables to run:",
    );
    console.log(
      "  TEST_SSH_HOST, TEST_SSH_PORT, TEST_SSH_USER, TEST_SSH_PASSWORD",
    );
  });
}
