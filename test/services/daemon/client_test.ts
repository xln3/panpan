/**
 * Tests for DaemonClient.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { DaemonServer } from "../../../src/services/daemon/server.ts";
import { DaemonClient, tryConnect } from "../../../src/services/daemon/client.ts";
import { withTempDir } from "../../_helpers/temp-dir.ts";

Deno.test("DaemonClient - connects and disconnects", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client = new DaemonClient({ socketPath });
    assertEquals(client.isConnected(), false);

    await client.connect();
    assertEquals(client.isConnected(), true);

    client.disconnect();
    assertEquals(client.isConnected(), false);

    await server.stop();
  });
});

Deno.test("DaemonClient - throws when not connected", async () => {
  const client = new DaemonClient({ socketPath: "/nonexistent.sock" });

  await assertRejects(
    () => client.ping(),
    Error,
    "Not connected to daemon",
  );
});

Deno.test("DaemonClient - handles connection failure", async () => {
  const client = new DaemonClient({
    socketPath: "/nonexistent/daemon.sock",
  });

  await assertRejects(() => client.connect());
});

Deno.test("DaemonClient - tryConnect returns null when daemon not running", async () => {
  await withTempDir(async (dir) => {
    const result = await tryConnect({
      socketPath: join(dir, "daemon.sock"),
    });

    assertEquals(result, null);
  });
});

Deno.test("DaemonClient - tryConnect returns client when daemon running", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client = await tryConnect({ socketPath });
    assertExists(client);
    assertEquals(client.isConnected(), true);

    client.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonClient - request timeout", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");

    // Create a slow server that doesn't respond
    const listener = Deno.listen({ transport: "unix", path: socketPath });

    const client = new DaemonClient({
      socketPath,
      timeout: 100, // Very short timeout
    });

    await client.connect();

    // Accept connection but don't respond
    const acceptPromise = listener.accept();

    await assertRejects(
      () => client.ping(),
      Error,
      "Request timeout",
    );

    client.disconnect();
    listener.close();

    // Clean up accepted connection if any
    try {
      const conn = await acceptPromise;
      conn.close();
    } catch {
      // Ignore
    }
  });
});

Deno.test("DaemonClient - session operations", async () => {
  await withTempDir(async (dir) => {
    const socketPath = join(dir, "daemon.sock");
    const server = new DaemonServer({
      dbPath: join(dir, "daemon.db"),
      socketPath,
    });

    await server.start();

    const client = new DaemonClient({ socketPath });
    await client.connect();

    // Create session
    const session = await client.createSession({
      projectRoot: "/my/project",
      model: "claude-opus",
      metadata: { key: "value" },
    });

    assertExists(session.id);
    assertEquals(session.projectRoot, "/my/project");
    assertEquals(session.model, "claude-opus");
    assertEquals(session.status, "active");
    assertEquals(session.metadata, { key: "value" });

    // Get session
    const retrieved = await client.getSession(session.id);
    assertEquals(retrieved.id, session.id);

    // List sessions
    const list = await client.listSessions();
    assertEquals(list.length, 1);
    assertEquals(list[0].id, session.id);

    // List with filter
    const filtered = await client.listSessions({ status: "completed" });
    assertEquals(filtered.length, 0);

    // Update session
    const updated = await client.updateSession(session.id, {
      status: "completed",
      completedAt: Date.now(),
    });
    assertEquals(updated.status, "completed");
    assertExists(updated.completedAt);

    client.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonClient - task operations", async () => {
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
      projectRoot: "/test",
      model: "haiku",
    });

    // Create task
    const task = await client.createTask({
      sessionId: session.id,
      type: "bash",
      description: "Run tests",
    });

    assertExists(task.id);
    assertEquals(task.sessionId, session.id);
    assertEquals(task.type, "bash");
    assertEquals(task.description, "Run tests");
    assertEquals(task.status, "pending");

    // Get task
    const retrieved = await client.getTask(task.id);
    assertEquals(retrieved.id, task.id);

    // List tasks
    const list = await client.listTasks({ sessionId: session.id });
    assertEquals(list.length, 1);

    // Update task
    const updated = await client.updateTask(task.id, {
      status: "running",
    });
    assertEquals(updated.status, "running");

    // Complete task
    const completed = await client.updateTask(task.id, {
      status: "completed",
      result: "All tests passed",
      completedAt: Date.now(),
    });
    assertEquals(completed.status, "completed");
    assertEquals(completed.result, "All tests passed");

    client.disconnect();
    await server.stop();
  });
});

Deno.test("DaemonClient - handles server errors", async () => {
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
    await assertRejects(
      () => client.getSession("invalid-id"),
      Error,
      "Session not found",
    );

    // Try to update non-existent session
    await assertRejects(
      () => client.updateSession("invalid-id", { status: "completed" }),
      Error,
      "Session not found",
    );

    // Try to get non-existent task
    await assertRejects(
      () => client.getTask("invalid-id"),
      Error,
      "Task not found",
    );

    client.disconnect();
    await server.stop();
  });
});
