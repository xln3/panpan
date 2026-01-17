/**
 * Tests for DaemonLifecycle.
 *
 * Note: These tests work with in-process servers to avoid
 * the complexity of testing process spawning.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { DaemonServer } from "../../../src/services/daemon/server.ts";
import { DaemonLifecycle } from "../../../src/services/daemon/lifecycle.ts";
import { withTempDir } from "../../_helpers/temp-dir.ts";

Deno.test("DaemonLifecycle - isRunning returns false when daemon not running", async () => {
  await withTempDir(async (dir) => {
    const lifecycle = new DaemonLifecycle({
      socketPath: join(dir, "daemon.sock"),
    });

    const running = await lifecycle.isRunning();
    assertEquals(running, false);
  });
});

Deno.test("DaemonLifecycle - isRunning returns true when daemon running", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const lifecycle = new DaemonLifecycle({ socketPath });
    const running = await lifecycle.isRunning();
    assertEquals(running, true);

    await server.stop();
  });
});

Deno.test("DaemonLifecycle - getClient returns null when not running", async () => {
  await withTempDir(async (dir) => {
    const lifecycle = new DaemonLifecycle({
      socketPath: join(dir, "daemon.sock"),
    });

    const client = await lifecycle.getClient();
    assertEquals(client, null);
  });
});

Deno.test("DaemonLifecycle - getClient returns client when running", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const lifecycle = new DaemonLifecycle({ socketPath });
    const client = await lifecycle.getClient();

    assertExists(client);
    assertEquals(client.isConnected(), true);

    // Verify it works
    const result = await client.ping();
    assertEquals(result.pong, true);

    client.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonLifecycle - stop gracefully shuts down daemon", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();
    assertEquals(server.isRunning(), true);

    const lifecycle = new DaemonLifecycle({ socketPath });
    await lifecycle.stop();

    // Wait for shutdown
    await new Promise((r) => setTimeout(r, 200));

    assertEquals(server.isRunning(), false);
  });
});

Deno.test("DaemonLifecycle - stop is safe when not running", async () => {
  await withTempDir(async (dir) => {
    const lifecycle = new DaemonLifecycle({
      socketPath: join(dir, "daemon.sock"),
    });

    // Should not throw
    await lifecycle.stop();
  });
});

Deno.test("DaemonLifecycle - multiple isRunning calls work", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const lifecycle = new DaemonLifecycle({ socketPath });

    // Multiple checks should all succeed
    assertEquals(await lifecycle.isRunning(), true);
    assertEquals(await lifecycle.isRunning(), true);
    assertEquals(await lifecycle.isRunning(), true);

    await server.stop();

    assertEquals(await lifecycle.isRunning(), false);
  });
});

Deno.test("DaemonLifecycle - getClient can be called multiple times", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const lifecycle = new DaemonLifecycle({ socketPath });

    // Get multiple clients
    const client1 = await lifecycle.getClient();
    const client2 = await lifecycle.getClient();

    assertExists(client1);
    assertExists(client2);

    // Both should work
    assertEquals((await client1.ping()).pong, true);
    assertEquals((await client2.ping()).pong, true);

    client1.disconnect();
    client2.disconnect();
    await server.stop();
  });
});
