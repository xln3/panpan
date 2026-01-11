/**
 * Tests for PM Tools
 */

import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert@1";
import { PMRequirementTool } from "../../src/tools/pm/pm-requirement.ts";
import { PMTestPlanTool } from "../../src/tools/pm/pm-testplan.ts";
import { PMBudgetTool, resetBudgetTracker } from "../../src/tools/pm/pm-budget.ts";
import { collectGenerator, createMockToolContext, withTempDir, createTempStructure } from "../_helpers/mod.ts";
import type { ToolYield } from "../../src/types/tool.ts";

// Type helper to extract result data
function getResultData<T>(results: ToolYield<T>[]): T {
  const result = results[0];
  if (result.type !== "result") {
    throw new Error("Expected result type");
  }
  return result.data;
}

// Reset state before each test group
function resetPMState() {
  resetBudgetTracker();
}

// PMRequirement Tests
Deno.test("PMRequirementTool - create action creates requirement", async () => {
  const context = createMockToolContext();

  const results = await collectGenerator(
    PMRequirementTool.call(
      { action: "create", requirement_text: "实现用户登录" },
      context,
    ),
  );

  const data = getResultData(results);
  assertExists(data.requirementId);
  assertEquals(data.status, "created");
});

Deno.test("PMRequirementTool - create action requires requirement_text", async () => {
  const context = createMockToolContext();

  const results = await collectGenerator(
    PMRequirementTool.call({ action: "create" }, context),
  );

  const data = getResultData(results);
  assertEquals(data.error?.includes("requirement_text"), true);
});

Deno.test("PMRequirementTool - analyze action detects vague terms", async () => {
  const context = createMockToolContext();

  // First create a requirement
  const createResults = await collectGenerator(
    PMRequirementTool.call(
      { action: "create", requirement_text: "实现一个快速的缓存" },
      context,
    ),
  );
  const reqId = getResultData(createResults).requirementId;

  // Then analyze it
  const analyzeResults = await collectGenerator(
    PMRequirementTool.call({ action: "analyze", requirement_id: reqId }, context),
  );

  const data = getResultData(analyzeResults);
  assertEquals(data.isClear, false);
  assertEquals(data.issues?.some((i: { term: string }) => i.term === "快"), true);
});

Deno.test("PMRequirementTool - add_qa action records question-answer", async () => {
  const context = createMockToolContext();

  // Create requirement
  const createResults = await collectGenerator(
    PMRequirementTool.call(
      { action: "create", requirement_text: "测试需求" },
      context,
    ),
  );
  const reqId = getResultData(createResults).requirementId;

  // Add Q&A
  const qaResults = await collectGenerator(
    PMRequirementTool.call(
      {
        action: "add_qa",
        requirement_id: reqId,
        question: "具体要求是什么？",
        answer: "响应时间 < 100ms",
      },
      context,
    ),
  );

  const data = getResultData(qaResults);
  assertEquals(data.status, "qa_added");
});

Deno.test("PMRequirementTool - get_criteria action extracts criteria", async () => {
  const context = createMockToolContext();

  // Create requirement
  const createResults = await collectGenerator(
    PMRequirementTool.call(
      { action: "create", requirement_text: "用户能够登录系统" },
      context,
    ),
  );
  const reqId = getResultData(createResults).requirementId;

  // Get criteria
  const criteriaResults = await collectGenerator(
    PMRequirementTool.call({ action: "get_criteria", requirement_id: reqId }, context),
  );

  const data = getResultData(criteriaResults);
  assertExists(data.acceptanceCriteria);
  assertEquals(data.acceptanceCriteria!.length > 0, true);
});

Deno.test("PMRequirementTool - list action returns all requirements", async () => {
  const context = createMockToolContext();

  // Create multiple requirements
  await collectGenerator(
    PMRequirementTool.call({ action: "create", requirement_text: "需求A" }, context),
  );
  await collectGenerator(
    PMRequirementTool.call({ action: "create", requirement_text: "需求B" }, context),
  );

  // List them
  const listResults = await collectGenerator(
    PMRequirementTool.call({ action: "list" }, context),
  );

  const data = getResultData(listResults);
  assertEquals(data.requirements!.length >= 2, true);
});

// PMTestPlan Tests
Deno.test("PMTestPlanTool - detect_framework detects deno", async () => {
  await withTempDir(async (dir: string) => {
    await createTempStructure(dir, {
      "deno.json": JSON.stringify({ tasks: { test: "deno test" } }),
    });

    const context = createMockToolContext({ cwd: dir });

    const results = await collectGenerator(
      PMTestPlanTool.call({ action: "detect_framework" }, context),
    );

    const data = getResultData(results);
    assertEquals(data.framework, "deno");
  });
});

Deno.test("PMTestPlanTool - find action searches for tests", async () => {
  await withTempDir(async (dir: string) => {
    await createTempStructure(dir, {
      "test": {
        "login_test.ts": "// login test",
      },
    });

    const context = createMockToolContext({ cwd: dir });

    const results = await collectGenerator(
      PMTestPlanTool.call({ action: "find", keyword: "login" }, context),
    );

    const data = getResultData(results);
    assertExists(data.tests);
  });
});

Deno.test("PMTestPlanTool - find_all action returns all tests", async () => {
  await withTempDir(async (dir: string) => {
    await createTempStructure(dir, {
      "test": {
        "a_test.ts": "// test",
        "b_test.ts": "// test",
      },
    });

    const context = createMockToolContext({ cwd: dir });

    const results = await collectGenerator(
      PMTestPlanTool.call({ action: "find_all" }, context),
    );

    const data = getResultData(results);
    assertEquals(data.tests?.length, 2);
  });
});

Deno.test("PMTestPlanTool - generate action creates test template", async () => {
  const context = createMockToolContext();

  // First create a requirement
  const createResults = await collectGenerator(
    PMRequirementTool.call(
      { action: "create", requirement_text: "实现缓存功能" },
      context,
    ),
  );
  const reqId = getResultData(createResults).requirementId;

  // Generate test
  const genResults = await collectGenerator(
    PMTestPlanTool.call(
      { action: "generate", requirement_id: reqId, framework: "deno" },
      context,
    ),
  );

  const data = getResultData(genResults);
  assertExists(data.template);
  assertStringIncludes(data.template!, "Deno.test");
  assertExists(data.testPath);
});

// PMBudget Tests
Deno.test("PMBudgetTool - init action initializes budget", async () => {
  resetPMState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    PMBudgetTool.call(
      {
        action: "init",
        token_limit: 10000,
        time_limit: 60000,
        attempts_limit: 5,
      },
      context,
    ),
  );

  const data = getResultData(results);
  assertEquals(data.status, "initialized");
  assertEquals(data.budget?.tokenLimit, 10000);
});

Deno.test("PMBudgetTool - check action returns budget status", async () => {
  resetPMState();
  const context = createMockToolContext();

  // Initialize first
  await collectGenerator(
    PMBudgetTool.call({ action: "init", token_limit: 10000 }, context),
  );

  // Check status
  const results = await collectGenerator(
    PMBudgetTool.call({ action: "check" }, context),
  );

  const data = getResultData(results);
  assertEquals(data.withinBudget, true);
  assertExists(data.budget);
});

Deno.test("PMBudgetTool - check action fails without init", async () => {
  resetPMState();
  const context = createMockToolContext();

  const results = await collectGenerator(
    PMBudgetTool.call({ action: "check" }, context),
  );

  const data = getResultData(results);
  assertExists(data.error);
  assertStringIncludes(data.error!, "未初始化");
});

Deno.test("PMBudgetTool - add_tokens action records token usage", async () => {
  resetPMState();
  const context = createMockToolContext();

  await collectGenerator(
    PMBudgetTool.call({ action: "init", token_limit: 10000 }, context),
  );

  const results = await collectGenerator(
    PMBudgetTool.call({ action: "add_tokens", tokens: 5000 }, context),
  );

  const data = getResultData(results);
  assertEquals(data.status, "tokens_added");
  assertEquals(data.budget?.tokenUsed, 5000);
});

Deno.test("PMBudgetTool - add_attempt action records attempt", async () => {
  resetPMState();
  const context = createMockToolContext();

  await collectGenerator(
    PMBudgetTool.call({ action: "init", attempts_limit: 5 }, context),
  );

  const results = await collectGenerator(
    PMBudgetTool.call({ action: "add_attempt" }, context),
  );

  const data = getResultData(results);
  assertEquals(data.status, "attempt_added");
  assertEquals(data.budget?.attemptsUsed, 1);
});

Deno.test("PMBudgetTool - report action generates report", async () => {
  resetPMState();
  const context = createMockToolContext();

  await collectGenerator(
    PMBudgetTool.call({ action: "init", token_limit: 10000 }, context),
  );

  const results = await collectGenerator(
    PMBudgetTool.call({ action: "report" }, context),
  );

  const data = getResultData(results);
  assertExists(data.report);
  assertStringIncludes(data.report!, "预算使用报告");
});

Deno.test("PMBudgetTool - check detects exhausted budget", async () => {
  resetPMState();
  const context = createMockToolContext();

  await collectGenerator(
    PMBudgetTool.call({ action: "init", attempts_limit: 2 }, context),
  );

  await collectGenerator(PMBudgetTool.call({ action: "add_attempt" }, context));
  await collectGenerator(PMBudgetTool.call({ action: "add_attempt" }, context));

  const results = await collectGenerator(
    PMBudgetTool.call({ action: "check" }, context),
  );

  const data = getResultData(results);
  assertEquals(data.withinBudget, false);
  assertExists(data.exhaustionReason);
});
