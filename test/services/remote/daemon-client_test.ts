/**
 * Tests for remote module - daemon client
 * Uses fetch mocking to test HTTP client without actual daemon
 */

import { assertEquals, assertRejects } from "@std/assert";
import { DaemonClient } from "../../../src/services/remote/daemon-client.ts";

// Helper to mock fetch
function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

Deno.test("DaemonClient - getHostname returns configured hostname", () => {
  const client = new DaemonClient("test-host", 8080, "test-token");
  assertEquals(client.getHostname(), "test-host");
});

Deno.test("DaemonClient - health returns daemon status", async () => {
  const restore = mockFetch((_url, init) => {
    const headers = new Headers(init?.headers);
    assertEquals(headers.get("Authorization"), "Bearer test-token");
    return Response.json({ status: "ok", pid: 1234, uptime: 5000 });
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    const health = await client.health();

    assertEquals(health.status, "ok");
    assertEquals(health.pid, 1234);
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - exec returns command output with host", async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(init?.body as string);
    assertEquals(body.command, "echo hello");
    assertEquals(body.cwd, "/tmp");

    return Response.json({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    });
  });

  try {
    const client = new DaemonClient("my-server", 8080, "test-token");
    const result = await client.exec({
      command: "echo hello",
      cwd: "/tmp",
    });

    assertEquals(result.stdout, "hello\n");
    assertEquals(result.stderr, "");
    assertEquals(result.exitCode, 0);
    assertEquals(result.host, "my-server"); // Host is always included
    assertEquals(result.durationMs >= 0, true);
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - exec passes environment variables", async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(init?.body as string);
    assertEquals(body.env, { MY_VAR: "value" });
    return Response.json({ stdout: "", stderr: "", exitCode: 0 });
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    await client.exec({
      command: "env",
      env: { MY_VAR: "value" },
    });
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - exec passes timeout", async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(init?.body as string);
    assertEquals(body.timeout, 120000);
    return Response.json({ stdout: "", stderr: "", exitCode: 0 });
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    await client.exec({
      command: "sleep 1",
      timeout: 120000,
    });
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - readFile returns file content", async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(init?.body as string);
    assertEquals(body.path, "/tmp/test.txt");
    return Response.json({ content: "file content here" });
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    const content = await client.readFile("/tmp/test.txt");

    assertEquals(content, "file content here");
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - readFile throws on error", async () => {
  const restore = mockFetch(() => {
    return Response.json({ error: "File not found" });
  });

  try {
    const client = new DaemonClient("my-host", 8080, "test-token");

    await assertRejects(
      () => client.readFile("/nonexistent"),
      Error,
      "[my-host]", // Error message includes hostname
    );
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - writeFile sends content", async () => {
  const restore = mockFetch((_url, init) => {
    const body = JSON.parse(init?.body as string);
    assertEquals(body.path, "/tmp/output.txt");
    assertEquals(body.content, "new content");
    return Response.json({ success: true });
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    await client.writeFile("/tmp/output.txt", "new content");
    // No exception means success
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - writeFile throws on error", async () => {
  const restore = mockFetch(() => {
    return Response.json({ error: "Permission denied" });
  });

  try {
    const client = new DaemonClient("server", 8080, "test-token");

    await assertRejects(
      () => client.writeFile("/root/file", "content"),
      Error,
      "[server]",
    );
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - shutdown sends request", async () => {
  let shutdownCalled = false;
  const restore = mockFetch((url) => {
    if (url.includes("/shutdown")) {
      shutdownCalled = true;
      return Response.json({ message: "Shutting down" });
    }
    return new Response("Not found", { status: 404 });
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    await client.shutdown();

    assertEquals(shutdownCalled, true);
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - shutdown ignores connection errors", async () => {
  const restore = mockFetch(() => {
    throw new Error("Connection reset");
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    // Should not throw
    await client.shutdown();
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - isAlive returns true when healthy", async () => {
  const restore = mockFetch(() => {
    return Response.json({ status: "ok", pid: 1234, uptime: 5000 });
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    const alive = await client.isAlive();

    assertEquals(alive, true);
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - isAlive returns false on error", async () => {
  const restore = mockFetch(() => {
    throw new Error("Connection refused");
  });

  try {
    const client = new DaemonClient("localhost", 8080, "test-token");
    const alive = await client.isAlive();

    assertEquals(alive, false);
  } finally {
    restore();
  }
});

Deno.test("DaemonClient - throws on non-ok response", async () => {
  const restore = mockFetch(() => {
    return new Response("Unauthorized", { status: 401 });
  });

  try {
    const client = new DaemonClient("server", 8080, "wrong-token");

    await assertRejects(
      () => client.health(),
      Error,
      "401",
    );
  } finally {
    restore();
  }
});
