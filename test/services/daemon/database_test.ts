/**
 * Tests for DaemonDatabase.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { DaemonDatabase } from "../../../src/services/daemon/database.ts";
import { withTempDir } from "../../_helpers/temp-dir.ts";

Deno.test("DaemonDatabase - opens and creates schema", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    assertEquals(db.isOpen(), true);

    db.close();
    assertEquals(db.isOpen(), false);
  });
});

Deno.test("DaemonDatabase - creates session", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    assertExists(session.id);
    assertEquals(session.projectRoot, "/test/project");
    assertEquals(session.model, "claude-haiku");
    assertEquals(session.status, "active");
    assertExists(session.createdAt);
    assertExists(session.updatedAt);

    db.close();
  });
});

Deno.test("DaemonDatabase - creates session with metadata", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
      metadata: { foo: "bar", count: 42 },
    });

    assertEquals(session.metadata, { foo: "bar", count: 42 });

    // Verify retrieval
    const retrieved = db.getSession(session.id);
    assertEquals(retrieved?.metadata, { foo: "bar", count: 42 });

    db.close();
  });
});

Deno.test("DaemonDatabase - gets session by ID", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    const retrieved = db.getSession(session.id);
    assertEquals(retrieved?.id, session.id);
    assertEquals(retrieved?.projectRoot, "/test/project");

    // Non-existent session
    const notFound = db.getSession("non-existent-id");
    assertEquals(notFound, null);

    db.close();
  });
});

Deno.test("DaemonDatabase - lists sessions", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    db.createSession({ projectRoot: "/project1", model: "haiku" });
    db.createSession({ projectRoot: "/project2", model: "opus" });
    db.createSession({ projectRoot: "/project1", model: "sonnet" });

    // List all
    const all = db.listSessions();
    assertEquals(all.length, 3);

    // Filter by project
    const project1 = db.listSessions({ projectRoot: "/project1" });
    assertEquals(project1.length, 2);

    // Limit
    const limited = db.listSessions({ limit: 2 });
    assertEquals(limited.length, 2);

    db.close();
  });
});

Deno.test("DaemonDatabase - updates session", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    const updated = db.updateSession(session.id, {
      status: "completed",
      completedAt: Date.now(),
    });

    assertEquals(updated?.status, "completed");
    assertExists(updated?.completedAt);

    // Update non-existent
    const notFound = db.updateSession("non-existent", { status: "failed" });
    assertEquals(notFound, null);

    db.close();
  });
});

Deno.test("DaemonDatabase - deletes session", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    const deleted = db.deleteSession(session.id);
    assertEquals(deleted, true);

    const retrieved = db.getSession(session.id);
    assertEquals(retrieved, null);

    // Delete non-existent
    const notFound = db.deleteSession("non-existent");
    assertEquals(notFound, false);

    db.close();
  });
});

Deno.test("DaemonDatabase - creates task", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    const task = db.createTask({
      sessionId: session.id,
      type: "file_edit",
      description: "Edit foo.ts",
    });

    assertExists(task.id);
    assertEquals(task.sessionId, session.id);
    assertEquals(task.type, "file_edit");
    assertEquals(task.description, "Edit foo.ts");
    assertEquals(task.status, "pending");
    assertExists(task.startedAt);

    db.close();
  });
});

Deno.test("DaemonDatabase - gets task by ID", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    const task = db.createTask({
      sessionId: session.id,
      type: "file_edit",
      description: "Edit foo.ts",
    });

    const retrieved = db.getTask(task.id);
    assertEquals(retrieved?.id, task.id);
    assertEquals(retrieved?.description, "Edit foo.ts");

    // Non-existent
    const notFound = db.getTask("non-existent");
    assertEquals(notFound, null);

    db.close();
  });
});

Deno.test("DaemonDatabase - lists tasks", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session1 = db.createSession({
      projectRoot: "/project1",
      model: "haiku",
    });
    const session2 = db.createSession({
      projectRoot: "/project2",
      model: "opus",
    });

    db.createTask({ sessionId: session1.id, type: "a", description: "Task 1" });
    db.createTask({ sessionId: session1.id, type: "b", description: "Task 2" });
    db.createTask({ sessionId: session2.id, type: "c", description: "Task 3" });

    // List all
    const all = db.listTasks();
    assertEquals(all.length, 3);

    // Filter by session
    const session1Tasks = db.listTasks({ sessionId: session1.id });
    assertEquals(session1Tasks.length, 2);

    // Limit
    const limited = db.listTasks({ limit: 2 });
    assertEquals(limited.length, 2);

    db.close();
  });
});

Deno.test("DaemonDatabase - updates task", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    const task = db.createTask({
      sessionId: session.id,
      type: "file_edit",
      description: "Edit foo.ts",
    });

    const updated = db.updateTask(task.id, {
      status: "completed",
      result: "Success!",
      completedAt: Date.now(),
    });

    assertEquals(updated?.status, "completed");
    assertEquals(updated?.result, "Success!");
    assertExists(updated?.completedAt);

    // Update non-existent
    const notFound = db.updateTask("non-existent", { status: "failed" });
    assertEquals(notFound, null);

    db.close();
  });
});

Deno.test("DaemonDatabase - deletes task", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    const task = db.createTask({
      sessionId: session.id,
      type: "file_edit",
      description: "Edit foo.ts",
    });

    const deleted = db.deleteTask(task.id);
    assertEquals(deleted, true);

    const retrieved = db.getTask(task.id);
    assertEquals(retrieved, null);

    db.close();
  });
});

Deno.test("DaemonDatabase - cascading delete", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const session = db.createSession({
      projectRoot: "/test/project",
      model: "claude-haiku",
    });

    const task = db.createTask({
      sessionId: session.id,
      type: "file_edit",
      description: "Edit foo.ts",
    });

    // Delete session should cascade to tasks
    db.deleteSession(session.id);

    const taskRetrieved = db.getTask(task.id);
    assertEquals(taskRetrieved, null);

    db.close();
  });
});

Deno.test("DaemonDatabase - filters by status", async () => {
  await withTempDir(async (dir) => {
    const db = new DaemonDatabase(join(dir, "test.db"));
    await db.open();

    const s1 = db.createSession({ projectRoot: "/p1", model: "haiku" });
    const s2 = db.createSession({ projectRoot: "/p2", model: "opus" });
    db.updateSession(s2.id, { status: "completed" });

    const active = db.listSessions({ status: "active" });
    assertEquals(active.length, 1);
    assertEquals(active[0].id, s1.id);

    const completed = db.listSessions({ status: "completed" });
    assertEquals(completed.length, 1);
    assertEquals(completed[0].id, s2.id);

    db.close();
  });
});

Deno.test("DaemonDatabase - reopens existing database", async () => {
  await withTempDir(async (dir) => {
    const dbPath = join(dir, "test.db");

    // First open
    const db1 = new DaemonDatabase(dbPath);
    await db1.open();
    const session = db1.createSession({
      projectRoot: "/test",
      model: "haiku",
    });
    db1.close();

    // Reopen
    const db2 = new DaemonDatabase(dbPath);
    await db2.open();
    const retrieved = db2.getSession(session.id);
    assertEquals(retrieved?.projectRoot, "/test");
    db2.close();
  });
});
