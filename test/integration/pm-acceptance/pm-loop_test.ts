/**
 * PM Acceptance Loop Integration Test
 *
 * Tests the PM's ability to:
 * 1. Track multiple failed attempts
 * 2. Continue retrying within budget
 * 3. Eventually succeed or exhaust budget
 */

import { assertEquals, assertGreater } from "@std/assert";
import {
  PMBudgetTool,
  resetBudgetTracker,
} from "../../../src/tools/pm/pm-budget.ts";
import { collectGenerator } from "../../_helpers/async-generator.ts";
import { createMockToolContext } from "../../_helpers/mock-context.ts";

interface BudgetResult {
  status?: string;
  withinBudget?: boolean;
  budget?: {
    tokenLimit: number;
    tokenUsed: number;
    tokenPercent: number;
    timeLimit: number;
    timeUsed: number;
    timePercent: number;
    attemptsLimit: number;
    attemptsUsed: number;
  };
  exhaustionReason?: string | null;
  report?: string;
  error?: string;
}

async function callPMBudget(
  action: string,
  options: Record<string, unknown> = {},
): Promise<BudgetResult> {
  const context = createMockToolContext();
  const results = await collectGenerator(
    PMBudgetTool.call({ action, ...options } as never, context),
  );
  const lastResult = results[results.length - 1];
  if (lastResult && "data" in lastResult) {
    return lastResult.data as BudgetResult;
  }
  return {};
}

Deno.test("PM acceptance loop - budget tracking through failures", async (t) => {
  resetBudgetTracker();

  await t.step("initialize budget with 5 attempts", async () => {
    const result = await callPMBudget("init", {
      token_limit: 10000,
      time_limit: 60000,
      attempts_limit: 5,
    });

    assertEquals(result.status, "initialized");
    assertEquals(result.budget!.attemptsLimit, 5);
    assertEquals(result.budget!.attemptsUsed, 0);
  });

  await t.step("simulate 3 failed attempts", async () => {
    // Failure 1
    await callPMBudget("add_attempt");
    let check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);
    assertEquals(check.budget!.attemptsUsed, 1);

    // Failure 2
    await callPMBudget("add_attempt");
    check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);
    assertEquals(check.budget!.attemptsUsed, 2);

    // Failure 3
    await callPMBudget("add_attempt");
    check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);
    assertEquals(check.budget!.attemptsUsed, 3);
  });

  await t.step("still within budget after 3 failures", async () => {
    const check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);
    assertEquals(check.budget!.attemptsLimit - check.budget!.attemptsUsed, 2);
  });

  await t.step("generate report shows progress", async () => {
    const result = await callPMBudget("report");
    assertGreater(result.report!.length, 0);
    assertEquals(result.report!.includes("尝试"), true);
  });

  resetBudgetTracker();
});

Deno.test("PM acceptance loop - budget exhaustion", async (t) => {
  resetBudgetTracker();

  await t.step("initialize with 3 attempts", async () => {
    await callPMBudget("init", {
      token_limit: 10000,
      time_limit: 60000,
      attempts_limit: 3,
    });
  });

  await t.step("exhaust all attempts", async () => {
    await callPMBudget("add_attempt");
    await callPMBudget("add_attempt");
    await callPMBudget("add_attempt");

    const check = await callPMBudget("check");
    assertEquals(check.withinBudget, false);
    assertEquals(check.exhaustionReason, "尝试次数耗尽");
  });

  resetBudgetTracker();
});

Deno.test("PM acceptance loop - token tracking", async (t) => {
  resetBudgetTracker();

  await t.step("initialize budget", async () => {
    await callPMBudget("init", {
      token_limit: 1000,
      time_limit: 60000,
      attempts_limit: 10,
    });
  });

  await t.step("track token usage across attempts", async () => {
    // Attempt 1: use 300 tokens
    await callPMBudget("add_tokens", { tokens: 300 });
    await callPMBudget("add_attempt");

    let check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);
    assertEquals(check.budget!.tokenUsed, 300);

    // Attempt 2: use 400 more tokens (total 700)
    await callPMBudget("add_tokens", { tokens: 400 });
    await callPMBudget("add_attempt");

    check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);
    assertEquals(check.budget!.tokenUsed, 700);

    // Attempt 3: use 400 more tokens (total 1100 > 1000 limit)
    await callPMBudget("add_tokens", { tokens: 400 });

    check = await callPMBudget("check");
    assertEquals(check.withinBudget, false);
    assertEquals(check.exhaustionReason, "Token 预算耗尽");
  });

  resetBudgetTracker();
});

Deno.test("PM acceptance loop - success before exhaustion", async (t) => {
  resetBudgetTracker();

  await t.step("scenario: fix bug on 3rd attempt", async () => {
    await callPMBudget("init", {
      token_limit: 10000,
      time_limit: 300000,
      attempts_limit: 5,
    });

    // Attempt 1: fail
    await callPMBudget("add_attempt");
    let check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);

    // Attempt 2: fail
    await callPMBudget("add_attempt");
    check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);

    // Attempt 3: success!
    await callPMBudget("add_attempt");
    check = await callPMBudget("check");
    assertEquals(check.withinBudget, true);
    assertEquals(check.budget!.attemptsUsed, 3);

    // Verify 2 attempts remaining
    assertEquals(check.budget!.attemptsLimit - check.budget!.attemptsUsed, 2);
  });

  await t.step("final report shows efficiency", async () => {
    const result = await callPMBudget("report");
    assertGreater(result.report!.length, 0);
  });

  resetBudgetTracker();
});
