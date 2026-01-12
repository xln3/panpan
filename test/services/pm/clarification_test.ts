/**
 * Tests for ClarificationHelper
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  ClarificationHelper,
  clarificationHelper,
} from "../../../src/services/pm/clarification.ts";

Deno.test("ClarificationHelper - analyzeRequirement detects vague term '快'", () => {
  const result = clarificationHelper.analyzeRequirement("实现一个快的缓存");

  assertEquals(result.isClear, false);
  assertEquals(result.issues.some((i) => i.term === "快"), true);
  assertEquals(result.suggestedQuestions.length > 0, true);
});

Deno.test("ClarificationHelper - analyzeRequirement detects vague term '优化'", () => {
  const result = clarificationHelper.analyzeRequirement("优化系统性能");

  assertEquals(result.isClear, false);
  assertEquals(result.issues.some((i) => i.term === "优化"), true);
});

Deno.test("ClarificationHelper - analyzeRequirement detects multiple vague terms", () => {
  const result = clarificationHelper.analyzeRequirement("快速优化系统，要好用");

  assertEquals(result.isClear, false);
  assertEquals(
    result.issues.filter((i) => i.type === "vague_term").length >= 2,
    true,
  );
});

Deno.test("ClarificationHelper - analyzeRequirement detects missing test info", () => {
  const result = clarificationHelper.analyzeRequirement("实现用户登录功能");

  assertEquals(
    result.issues.some((i) =>
      i.type === "missing_info" && i.term === "测试要求"
    ),
    true,
  );
});

Deno.test("ClarificationHelper - analyzeRequirement allows test mention", () => {
  const result = clarificationHelper.analyzeRequirement(
    "实现用户登录功能，包含单元测试",
  );

  assertEquals(
    result.issues.some((i) => i.term === "测试要求"),
    false,
  );
});

Deno.test("ClarificationHelper - analyzeRequirement detects missing error handling", () => {
  const result = clarificationHelper.analyzeRequirement("实现数据导入功能");

  assertEquals(
    result.issues.some((i) =>
      i.type === "missing_info" && i.term === "错误处理"
    ),
    true,
  );
});

Deno.test("ClarificationHelper - analyzeRequirement allows error mention", () => {
  const result = clarificationHelper.analyzeRequirement(
    "实现数据导入，错误时记录日志",
  );

  assertEquals(
    result.issues.some((i) => i.term === "错误处理"),
    false,
  );
});

Deno.test("ClarificationHelper - analyzeRequirement detects ambiguous scope", () => {
  const result = clarificationHelper.analyzeRequirement(
    "支持多种格式，如 JSON、XML 等",
  );

  assertEquals(
    result.issues.some((i) => i.type === "ambiguity" && i.term === "范围模糊"),
    true,
  );
});

Deno.test("ClarificationHelper - analyzeRequirement returns clear for specific requirement", () => {
  const result = clarificationHelper.analyzeRequirement(
    "实现 LRU 缓存，容量 1000 条，包含单元测试，缓存未命中时抛出 error",
  );

  // No high severity issues means it's clear
  assertEquals(result.isClear, true);
});

Deno.test("ClarificationHelper - extractAcceptanceCriteria from basic requirement", () => {
  const criteria = clarificationHelper.extractAcceptanceCriteria(
    "用户能够登录系统",
    [],
  );

  assertEquals(criteria.length > 0, true);
  assertEquals(criteria.some((c) => c.includes("功能验证")), true);
});

Deno.test("ClarificationHelper - extractAcceptanceCriteria from QA with numbers", () => {
  const qas = [
    { question: "响应时间要求？", answer: "< 100ms", timestamp: Date.now() },
    {
      question: "支持多少并发？",
      answer: "1000 个连接",
      timestamp: Date.now(),
    },
  ];

  const criteria = clarificationHelper.extractAcceptanceCriteria(
    "实现高性能服务",
    qas,
  );

  assertEquals(criteria.length >= 2, true);
  assertEquals(criteria.some((c) => c.includes("100")), true);
  assertEquals(criteria.some((c) => c.includes("1000")), true);
});

Deno.test("ClarificationHelper - extractAcceptanceCriteria provides defaults", () => {
  const criteria = clarificationHelper.extractAcceptanceCriteria(
    "修复 bug",
    [],
  );

  assertEquals(criteria.length >= 1, true);
  assertEquals(
    criteria.some((c) => c.includes("编译") || c.includes("运行")),
    true,
  );
});

Deno.test("ClarificationHelper - hasVagueTerm returns true for vague term", () => {
  assertEquals(clarificationHelper.hasVagueTerm("需要快速响应", "快"), true);
  assertEquals(clarificationHelper.hasVagueTerm("需要快速响应", "慢"), false);
});

Deno.test("ClarificationHelper - getQuestionForTerm returns question", () => {
  const question = clarificationHelper.getQuestionForTerm("快");

  assertExists(question);
  assertEquals(question.includes("快"), true);
});

Deno.test("ClarificationHelper - getQuestionForTerm returns undefined for unknown term", () => {
  const question = clarificationHelper.getQuestionForTerm("未知术语");

  assertEquals(question, undefined);
});

Deno.test("ClarificationHelper - addVagueTerm adds custom term", () => {
  const helper = new ClarificationHelper();
  helper.addVagueTerm("神奇", "请说明'神奇'的具体含义？");

  const result = helper.analyzeRequirement("实现一个神奇的功能");

  assertEquals(result.issues.some((i) => i.term === "神奇"), true);
});

Deno.test("ClarificationHelper - getVagueTerms returns all terms", () => {
  const terms = clarificationHelper.getVagueTerms();

  assertEquals(terms.length >= 10, true);
  assertEquals(terms.some((t) => t.term === "快"), true);
  assertEquals(terms.some((t) => t.term === "优化"), true);
});
