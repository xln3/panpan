/**
 * Tests for BudgetTracker
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { BudgetTracker } from "../../../src/services/pm/budget-tracker.ts";

Deno.test("BudgetTracker - initializes with config", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  const status = tracker.getStatus();

  assertEquals(status.tokenLimit, 10000);
  assertEquals(status.timeLimit, 60000);
  assertEquals(status.attemptsLimit, 5);
  assertEquals(status.tokenUsed, 0);
  assertEquals(status.attemptsUsed, 0);
});

Deno.test("BudgetTracker - addTokens increases token usage", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addTokens(1000);
  assertEquals(tracker.getStatus().tokenUsed, 1000);

  tracker.addTokens(500);
  assertEquals(tracker.getStatus().tokenUsed, 1500);
});

Deno.test("BudgetTracker - addAttempt increments attempt count", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addAttempt();
  assertEquals(tracker.getStatus().attemptsUsed, 1);

  tracker.addAttempt();
  assertEquals(tracker.getStatus().attemptsUsed, 2);
});

Deno.test("BudgetTracker - isWithinBudget returns true initially", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  assertEquals(tracker.isWithinBudget(), true);
});

Deno.test("BudgetTracker - isWithinBudget returns false when tokens exhausted", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 1000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addTokens(1000);
  assertEquals(tracker.isWithinBudget(), false);
});

Deno.test("BudgetTracker - isWithinBudget returns false when attempts exhausted", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 3,
  });

  tracker.addAttempt();
  tracker.addAttempt();
  tracker.addAttempt();
  assertEquals(tracker.isWithinBudget(), false);
});

Deno.test("BudgetTracker - getExhaustionReason returns null when within budget", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  assertEquals(tracker.getExhaustionReason(), null);
});

Deno.test("BudgetTracker - getExhaustionReason returns token reason", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 1000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addTokens(1000);
  const reason = tracker.getExhaustionReason();

  assertExists(reason);
  assertStringIncludes(reason, "Token");
});

Deno.test("BudgetTracker - getExhaustionReason returns attempts reason", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 2,
  });

  tracker.addAttempt();
  tracker.addAttempt();
  const reason = tracker.getExhaustionReason();

  assertExists(reason);
  assertStringIncludes(reason, "尝试");
});

Deno.test("BudgetTracker - getStatus calculates percentages", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 10,
  });

  tracker.addTokens(5000);
  tracker.addAttempt();
  tracker.addAttempt();
  tracker.addAttempt();

  const status = tracker.getStatus();

  assertEquals(status.tokenPercent, 50);
  assertEquals(status.attemptsPercent, 30);
});

Deno.test("BudgetTracker - getStatus caps percentages at 100", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 1000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addTokens(2000); // Over limit

  const status = tracker.getStatus();

  assertEquals(status.tokenPercent, 100);
});

Deno.test("BudgetTracker - getRemaining returns remaining budget", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addTokens(3000);
  tracker.addAttempt();
  tracker.addAttempt();

  const remaining = tracker.getRemaining();

  assertEquals(remaining.tokens, 7000);
  assertEquals(remaining.attempts, 3);
});

Deno.test("BudgetTracker - getRemaining returns 0 when exhausted", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 1000,
    timeLimit: 60000,
    attemptsLimit: 2,
  });

  tracker.addTokens(1500);
  tracker.addAttempt();
  tracker.addAttempt();
  tracker.addAttempt();

  const remaining = tracker.getRemaining();

  assertEquals(remaining.tokens, 0);
  assertEquals(remaining.attempts, 0);
});

Deno.test("BudgetTracker - reset clears all usage", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addTokens(5000);
  tracker.addAttempt();
  tracker.addAttempt();

  tracker.reset();

  const status = tracker.getStatus();
  assertEquals(status.tokenUsed, 0);
  assertEquals(status.attemptsUsed, 0);
  assertEquals(status.timeUsed, 0);
});

Deno.test("BudgetTracker - getReport generates markdown report", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 10000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addTokens(5000);
  tracker.addAttempt();

  const report = tracker.getReport();

  assertStringIncludes(report, "预算使用报告");
  assertStringIncludes(report, "Token");
  assertStringIncludes(report, "5000");
  assertStringIncludes(report, "50%");
});

Deno.test("BudgetTracker - getReport shows exhausted status", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 1000,
    timeLimit: 60000,
    attemptsLimit: 5,
  });

  tracker.addTokens(1000);

  const report = tracker.getReport();

  assertStringIncludes(report, "预算已耗尽");
});

Deno.test("BudgetTracker - onBudgetEvent emits warning at threshold", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 1000,
    timeLimit: 60000,
    attemptsLimit: 10,
  });

  const events: string[] = [];
  tracker.onBudgetEvent((event) => {
    events.push(event);
  });

  // 80% should trigger warning
  tracker.addTokens(800);

  assertEquals(events.includes("warning"), true);
});

Deno.test("BudgetTracker - onBudgetEvent emits exceeded at limit", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 1000,
    timeLimit: 60000,
    attemptsLimit: 10,
  });

  const events: string[] = [];
  tracker.onBudgetEvent((event) => {
    events.push(event);
  });

  tracker.addTokens(1000);

  assertEquals(events.includes("exceeded"), true);
});

Deno.test("BudgetTracker - offBudgetEvent removes listener", () => {
  const tracker = new BudgetTracker({
    tokenLimit: 1000,
    timeLimit: 60000,
    attemptsLimit: 10,
  });

  const events: string[] = [];
  const listener = (event: string) => {
    events.push(event);
  };

  tracker.onBudgetEvent(listener);
  tracker.offBudgetEvent(listener);

  tracker.addTokens(1000);

  assertEquals(events.length, 0);
});
