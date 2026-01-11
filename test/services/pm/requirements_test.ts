/**
 * Tests for RequirementsManager
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { RequirementsManager } from "../../../src/services/pm/requirements.ts";

Deno.test("RequirementsManager - create generates unique ID", () => {
  const manager = new RequirementsManager();

  const req1 = manager.create("实现用户登录功能");
  const req2 = manager.create("添加缓存功能");

  assertExists(req1.id);
  assertExists(req2.id);
  assertEquals(req1.id !== req2.id, true);
});

Deno.test("RequirementsManager - create initializes status to draft", () => {
  const manager = new RequirementsManager();

  const req = manager.create("实现一个快速的缓存");

  assertEquals(req.status, "draft");
  assertEquals(req.original, "实现一个快速的缓存");
  assertEquals(req.clarified, "实现一个快速的缓存"); // Initial clarified = original
  assertEquals(req.questions.length, 0);
  assertEquals(req.acceptance.length, 0);
});

Deno.test("RequirementsManager - get returns undefined for non-existent ID", () => {
  const manager = new RequirementsManager();

  const result = manager.get("non-existent-id");

  assertEquals(result, undefined);
});

Deno.test("RequirementsManager - get returns requirement by ID", () => {
  const manager = new RequirementsManager();

  const created = manager.create("测试需求");
  const retrieved = manager.get(created.id);

  assertExists(retrieved);
  assertEquals(retrieved.id, created.id);
  assertEquals(retrieved.original, "测试需求");
});

Deno.test("RequirementsManager - addQA adds question-answer pair", () => {
  const manager = new RequirementsManager();

  const req = manager.create("实现快速缓存");
  manager.addQA(req.id, "快的标准是什么？", "响应时间 < 100ms");

  const updated = manager.get(req.id);
  assertExists(updated);
  assertEquals(updated.questions.length, 1);
  assertEquals(updated.questions[0].question, "快的标准是什么？");
  assertEquals(updated.questions[0].answer, "响应时间 < 100ms");
});

Deno.test("RequirementsManager - addQA accumulates multiple QAs", () => {
  const manager = new RequirementsManager();

  const req = manager.create("优化系统性能");
  manager.addQA(req.id, "优化哪方面？", "响应时间");
  manager.addQA(req.id, "目标是什么？", "P99 < 200ms");

  const updated = manager.get(req.id);
  assertExists(updated);
  assertEquals(updated.questions.length, 2);
});

Deno.test("RequirementsManager - updateClarified sets clarified text", () => {
  const manager = new RequirementsManager();

  const req = manager.create("实现缓存");
  manager.updateClarified(req.id, "实现一个 LRU 缓存，最大容量 1000 条");

  const updated = manager.get(req.id);
  assertExists(updated);
  assertEquals(updated.clarified, "实现一个 LRU 缓存，最大容量 1000 条");
});

Deno.test("RequirementsManager - setAcceptance sets acceptance criteria", () => {
  const manager = new RequirementsManager();

  const req = manager.create("实现登录");
  const criteria = ["用户名密码正确时返回 token", "密码错误时返回 401"];
  manager.setAcceptance(req.id, criteria);

  const updated = manager.get(req.id);
  assertExists(updated);
  assertEquals(updated.acceptance, criteria);
});

Deno.test("RequirementsManager - updateStatus changes requirement status", () => {
  const manager = new RequirementsManager();

  const req = manager.create("测试需求");
  assertEquals(req.status, "draft");

  manager.updateStatus(req.id, "clarified");
  const updated = manager.get(req.id);
  assertExists(updated);
  assertEquals(updated.status, "clarified");

  manager.updateStatus(req.id, "verified");
  const verified = manager.get(req.id);
  assertExists(verified);
  assertEquals(verified.status, "verified");
});

Deno.test("RequirementsManager - list returns all requirements", () => {
  const manager = new RequirementsManager();

  manager.create("需求1");
  manager.create("需求2");
  manager.create("需求3");

  const all = manager.list();
  assertEquals(all.length, 3);
});

Deno.test("RequirementsManager - list returns empty array when no requirements", () => {
  const manager = new RequirementsManager();

  const all = manager.list();
  assertEquals(all.length, 0);
});
