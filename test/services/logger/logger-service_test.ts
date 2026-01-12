/**
 * Tests for LoggerService - main service
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { LoggerService } from "../../../src/services/logger/logger-service.ts";

Deno.test("LoggerService - initialize sets default level", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "summary" });

  assertEquals(service.getLevel(), "summary");
  service.reset();
});

Deno.test("LoggerService - setLevel changes level", () => {
  const service = new LoggerService();

  service.setLevel("full");
  assertEquals(service.getLevel(), "full");

  service.setLevel("summary");
  assertEquals(service.getLevel(), "summary");
});

Deno.test("LoggerService - hooks integration", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();

  // Use hooks to log events
  hooks.onToolStart("TestTool", { input: "test" });
  hooks.onToolComplete("TestTool", { result: "done" }, 100);

  // Query should return the entries
  const entries = service.getAll();
  assertEquals(entries.length >= 2, true);

  service.reset();
});

Deno.test("LoggerService - getSummary generates readable summary", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();
  hooks.onToolStart("Bash", { command: "ls" });
  hooks.onToolComplete("Bash", { stdout: "files" }, 50);
  hooks.onToolStart("Read", { path: "/test.ts" });
  hooks.onToolComplete("Read", { content: "..." }, 30);

  const summary = service.getSummary();

  assertExists(summary);
  assertStringIncludes(summary, "操作摘要");
  assertStringIncludes(summary, "成功");

  service.reset();
});

Deno.test("LoggerService - getTimeline generates timeline", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();
  hooks.onToolStart("TestTool", { input: "test" });
  hooks.onToolComplete("TestTool", { result: "done" }, 100);

  const timeline = service.getTimeline();

  assertExists(timeline);
  assertStringIncludes(timeline, "时间线");
  assertStringIncludes(timeline, "TestTool");

  service.reset();
});

Deno.test("LoggerService - analyzeFailures detects failures", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();
  hooks.onToolStart("Pip", { package: "nonexistent" });
  hooks.onToolError("Pip", new Error("Connection timeout"));

  const failures = service.analyzeFailures();

  assertEquals(failures.length >= 1, true);
  assertEquals(failures[0].suggestedFixes.length > 0, true);

  service.reset();
});

Deno.test("LoggerService - getFailureSummary for empty failures", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();
  hooks.onToolComplete("TestTool", { result: "success" }, 100);

  const summary = service.getFailureSummary();

  assertStringIncludes(summary, "成功完成");

  service.reset();
});

Deno.test("LoggerService - export JSON format", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();
  hooks.onToolComplete("TestTool", { result: "done" }, 100);

  const json = service.export("json");
  const parsed = JSON.parse(json);

  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed.length >= 1, true);

  service.reset();
});

Deno.test("LoggerService - export Markdown format", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();
  hooks.onToolComplete("TestTool", { result: "done" }, 100);

  const markdown = service.export("markdown");

  assertStringIncludes(markdown, "# Operation Log");

  service.reset();
});

Deno.test("LoggerService - clear removes all entries", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();
  hooks.onToolComplete("TestTool", { result: "done" }, 100);

  assertEquals(service.size() >= 1, true);

  service.clear();
  assertEquals(service.size(), 0);

  service.reset();
});

Deno.test("LoggerService - query with filters", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "full" });

  const hooks = service.getHooks();
  hooks.onToolComplete("TestTool", { result: "done" }, 100);
  hooks.onToolError("FailingTool", new Error("Test error"));

  const failures = service.query({ failuresOnly: true });
  assertEquals(failures.length >= 1, true);
  assertEquals(failures.every((e) => !e.success), true);

  service.reset();
});

Deno.test("LoggerService - getOneLiner generates compact summary", () => {
  const service = new LoggerService();
  service.initialize({ defaultLevel: "tool" });

  const hooks = service.getHooks();
  hooks.onToolComplete("TestTool", { result: "done" }, 100);

  const oneLiner = service.getOneLiner();

  assertExists(oneLiner);
  assertStringIncludes(oneLiner, "ops");
  assertStringIncludes(oneLiner, "success");

  service.reset();
});
