/**
 * Tests for DaemonServer.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { DaemonServer } from "../../../src/services/daemon/server.ts";
import { DaemonClient } from "../../../src/services/daemon/client.ts";
import { withTempDir } from "../../_helpers/temp-dir.ts";

// Helper to wait for condition with timeout
async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("Timeout waiting for condition");
}

Deno.test("DaemonServer - starts and stops", async () => {
  await withTempDir(async (dir) => {
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath: join(dir, "daemon.sock"),
    });

    await server.start();
    assertEquals(server.isRunning(), true);

    await server.stop();
    assertEquals(server.isRunning(), false);
  });
});

Deno.test("DaemonServer - handles ping", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client = new DaemonClient({ socketPath });
    await client.connect();

    const result = await client.ping();
    assertEquals(result.pong, true);

    client.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonServer - handles session CRUD", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client = new DaemonClient({ socketPath });
    await client.connect();

    // Create
    const session = await client.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });
    assertExists(session.id);
    assertEquals(session.status, "active");

    // Get
    const retrieved = await client.getSession(session.id);
    assertEquals(retrieved.id, session.id);

    // List
    const list = await client.listSessions();
    assertEquals(list.length, 1);

    // Update
    const updated = await client.updateSession(session.id, {
      status: "completed",
    });
    assertEquals(updated.status, "completed");

    client.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonServer - handles task CRUD", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client = new DaemonClient({ socketPath });
    await client.connect();

    // Create session first
    const session = await client.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    // Create task
    const task = await client.createTask({
      sessionId: session.id,
      type: "file_edit",
      description: "Edit foo.ts",
    });
    assertExists(task.id);
    assertEquals(task.status, "pending");

    // Get
    const retrieved = await client.getTask(task.id);
    assertEquals(retrieved.id, task.id);

    // List
    const list = await client.listTasks({ sessionId: session.id });
    assertEquals(list.length, 1);

    // Update
    const updated = await client.updateTask(task.id, {
      status: "completed",
      result: "Success!",
    });
    assertEquals(updated.status, "completed");
    assertEquals(updated.result, "Success!");

    client.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonServer - handles errors gracefully", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client = new DaemonClient({ socketPath });
    await client.connect();

    // Try to get non-existent session
    let error: Error | null = null;
    try {
      await client.getSession("non-existent-id");
    } catch (e) {
      error = e as Error;
    }
    assertExists(error);
    assertEquals(error.message, "Session not found");

    // Try to get non-existent task
    error = null;
    try {
      await client.getTask("non-existent-id");
    } catch (e) {
      error = e as Error;
    }
    assertExists(error);
    assertEquals(error.message, "Task not found");

    client.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonServer - handles shutdown request", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();
    assertEquals(server.isRunning(), true);

    const client = new DaemonClient({ socketPath });
    await client.connect();

    await client.shutdown();

    // Wait for server to stop
    await waitFor(() => !server.isRunning());
    assertEquals(server.isRunning(), false);
  });
});

Deno.test("DaemonServer - handles multiple clients", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client1 = new DaemonClient({ socketPath });
    const client2 = new DaemonClient({ socketPath });

    await client1.connect();
    await client2.connect();

    // Both clients should work
    const result1 = await client1.ping();
    const result2 = await client2.ping();

    assertEquals(result1.pong, true);
    assertEquals(result2.pong, true);

    // Create session from client1
    const session = await client1.createSession({
      projectRoot: "/test",
      model: "haiku",
    });

    // Should be visible from client2
    const retrieved = await client2.getSession(session.id);
    assertEquals(retrieved.projectRoot, "/test");

    client1.disconnect();
    client2.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonServer - cleans up on client disconnect", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client = new DaemonClient({ socketPath });
    await client.connect();

    // Do some work
    await client.ping();

    // Disconnect abruptly
    client.disconnect();

    // Small delay to let server process disconnect
    await new Promise((r) => setTimeout(r, 50));

    // Server should still be running
    assertEquals(server.isRunning(), true);

    // New client should work
    const client2 = new DaemonClient({ socketPath });
    await client2.connect();
    const result = await client2.ping();
    assertEquals(result.pong, true);

    client2.disconnect();
    await server.stop();
  });
});
