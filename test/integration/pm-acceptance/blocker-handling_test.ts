/**
 * PM SA Blocker Handling Integration Tests
 *
 * These tests verify that PM SA correctly handles external blockers
 * by automatically trying alternatives instead of stopping.
 *
 * Test scenarios:
 * 1. Network blocker detection and resolution
 * 2. Complete alternative cycling until success
 * 3. Complete alternative cycling until exhaustion
 * 4. Budget integration with alternative attempts
 */

import { assertEquals, assertExists, assertGreater } from "@std/assert";
import {
  PMAlternativeTool,
  PMBudgetTool,
  resetAlternativeManager,
  resetBudgetTracker,
} from "../../../src/tools/pm/mod.ts";
import { collectGenerator } from "../../_helpers/async-generator.ts";
import { createMockToolContext } from "../../_helpers/mock-context.ts";

// Helper to call PM tools
async function callTool<T>(
  // deno-lint-ignore no-explicit-any
  tool: any,
  input: Record<string, unknown>,
): Promise<T> {
  const context = createMockToolContext();
  const results = await collectGenerator(tool.call(input, context));
  const lastResult = results[results.length - 1];
  if (lastResult && typeof lastResult === "object" && "data" in lastResult) {
    return (lastResult as { data: T }).data;
  }
  throw new Error("No result from tool");
}

interface AlternativeResult {
  blockerType?: string | null;
  alternatives?: Array<{
    id: string;
    description: string;
    confidence: number;
  }>;
  nextPlan?: { id: string; description: string } | null;
  markedPlan?: { id: string; result: string };
  isExhausted?: boolean;
  successfulPlan?: { id: string } | null;
  report?: string;
  error?: string;
}

interface BudgetResult {
  status?: string;
  withinBudget?: boolean;
  budget?: {
    attemptsUsed: number;
    attemptsLimit: number;
  };
}

/**
 * Scenario 1: HuggingFace download blocked, resolved via mirror
 *
 * Simulates:
 * 1. Attempting to download model from HuggingFace
 * 2. Getting "Network unreachable" error
 * 3. PMAlternative detecting blocker type
 * 4. Trying hf-mirror.com (succeeds)
 * 5. Continuing with main task
 */
Deno.test("PM SA Blocker Handling - HuggingFace blocked, mirror succeeds", async (t) => {
  resetAlternativeManager();
  resetBudgetTracker();

  // Initialize budget for this task
  await t.step("initialize budget", async () => {
    const result = await callTool<BudgetResult>(PMBudgetTool, {
      action: "init",
      token_limit: 10000,
      attempts_limit: 5,
    });
    assertEquals(result.status, "initialized");
  });

  // Simulate: Download attempt fails
  const errorMessage =
    "OSError: We couldn't connect to 'https://huggingface.co' - Network is unreachable";

  await t.step("detect blocker type from error", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "detect",
      error_message: errorMessage,
    });

    assertEquals(result.blockerType, "huggingface_blocked");
  });

  await t.step("initialize alternatives for blocker", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "init",
      blocker_type: "huggingface_blocked",
    });

    assertExists(result.alternatives);
    assertGreater(result.alternatives!.length, 0);
  });

  await t.step("get first alternative (highest confidence)", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });

    assertExists(result.nextPlan);
    // First should be one of the high-confidence options
  });

  await t.step("mark alternative as successful", async () => {
    // Get the current plan
    const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });
    const planId = nextResult.nextPlan!.id;

    // Mark as success (simulating: mirror worked!)
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "mark_success",
      plan_id: planId,
    });

    assertEquals(result.markedPlan!.result, "success");
    assertExists(result.successfulPlan);
  });

  await t.step("generate final report", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "report",
    });

    assertExists(result.report);
    assertEquals(result.report!.includes("成功方案"), true);
  });

  // Check budget - should have used 0 attempts for the main task
  // (alternative attempts don't count as main task attempts)
  await t.step("verify budget not consumed by alternative attempts", async () => {
    const result = await callTool<BudgetResult>(PMBudgetTool, {
      action: "check",
    });

    assertEquals(result.withinBudget, true);
    assertEquals(result.budget!.attemptsUsed, 0);
  });
});

/**
 * Scenario 2: Multiple alternatives fail before success
 *
 * Simulates:
 * 1. Google Drive download blocked
 * 2. Try gdown (fails)
 * 3. Try local SCP (succeeds)
 */
Deno.test("PM SA Blocker Handling - Multiple failures before success", async (t) => {
  resetAlternativeManager();

  await t.step("detect Google Drive blocker", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "detect",
      error_message:
        "HTTPSConnectionPool(host='drive.google.com'): Max retries exceeded",
    });

    assertEquals(result.blockerType, "google_drive_blocked");
  });

  await t.step("initialize alternatives", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "init",
      blocker_type: "google_drive_blocked",
    });

    assertExists(result.alternatives);
  });

  // Fail first alternative
  await t.step("first alternative fails", async () => {
    const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });
    const planId = nextResult.nextPlan!.id;

    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "mark_failed",
      plan_id: planId,
      failure_reason: "gdown also blocked by firewall",
    });

    assertEquals(result.markedPlan!.result, "failed");
    assertEquals(result.isExhausted, false);
  });

  // Succeed on second alternative
  await t.step("second alternative succeeds", async () => {
    const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });
    const planId = nextResult.nextPlan!.id;

    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "mark_success",
      plan_id: planId,
    });

    assertEquals(result.markedPlan!.result, "success");
    assertExists(result.successfulPlan);
  });

  await t.step("report shows both attempts", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "report",
    });

    assertExists(result.report);
    // Should have 1 failure and 1 success
    assertEquals(result.report!.includes("❌"), true);
    assertEquals(result.report!.includes("✅"), true);
    assertEquals(result.report!.includes("gdown also blocked"), true);
  });
});

/**
 * Scenario 3: All alternatives exhausted
 *
 * Simulates:
 * 1. Permission denied error
 * 2. All 3 alternatives fail
 * 3. Report shows exhaustion
 */
Deno.test("PM SA Blocker Handling - All alternatives exhausted", async (t) => {
  resetAlternativeManager();

  await t.step("detect permission blocker", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "detect",
      error_message: "PermissionError: [Errno 13] Permission denied: '/etc/config'",
    });

    assertEquals(result.blockerType, "permission_denied");
  });

  await t.step("initialize alternatives", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "init",
      blocker_type: "permission_denied",
    });

    assertExists(result.alternatives);
  });

  await t.step("fail all alternatives", async () => {
    let exhausted = false;
    let count = 0;
    const maxIterations = 10;

    while (!exhausted && count < maxIterations) {
      const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
        action: "next",
      });

      if (nextResult.isExhausted || !nextResult.nextPlan) {
        exhausted = true;
        break;
      }

      await callTool<AlternativeResult>(PMAlternativeTool, {
        action: "mark_failed",
        plan_id: nextResult.nextPlan.id,
        failure_reason: `Attempt ${count + 1}: still permission denied`,
      });

      count++;
    }

    assertEquals(exhausted, true);
    assertGreater(count, 0);
  });

  await t.step("report shows exhaustion", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "report",
    });

    assertExists(result.report);
    assertEquals(result.report!.includes("所有备选方案已耗尽"), true);
    assertEquals(result.successfulPlan, null);
  });
});

/**
 * Scenario 4: Budget + Alternative integration
 *
 * Simulates:
 * 1. Initialize budget with limited attempts
 * 2. Main task fails (uses budget attempt)
 * 3. Alternative handling (does not use budget)
 * 4. Resume main task (uses budget attempt)
 */
Deno.test("PM SA Blocker Handling - Budget and alternatives work together", async (t) => {
  resetAlternativeManager();
  resetBudgetTracker();

  await t.step("initialize budget with 3 attempts", async () => {
    const result = await callTool<BudgetResult>(PMBudgetTool, {
      action: "init",
      token_limit: 10000,
      attempts_limit: 3,
    });
    assertEquals(result.status, "initialized");
  });

  // Main task attempt 1: network fails
  await t.step("main task attempt 1 - network error", async () => {
    // Record main task attempt
    await callTool<BudgetResult>(PMBudgetTool, { action: "add_attempt" });

    // Simulate network error
    const detectResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "detect",
      error_message: "Network unreachable to huggingface.co",
    });
    assertEquals(detectResult.blockerType, "huggingface_blocked");
  });

  await t.step("resolve blocker via alternatives", async () => {
    // Init and try alternatives (these don't consume budget)
    await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "init",
      blocker_type: "huggingface_blocked",
    });

    const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });

    await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "mark_success",
      plan_id: nextResult.nextPlan!.id,
    });
  });

  // Main task attempt 2: code error (unrelated to network)
  await t.step("main task attempt 2 - code error", async () => {
    await callTool<BudgetResult>(PMBudgetTool, { action: "add_attempt" });

    const check = await callTool<BudgetResult>(PMBudgetTool, { action: "check" });
    assertEquals(check.budget!.attemptsUsed, 2);
    assertEquals(check.withinBudget, true);
  });

  // Main task attempt 3: success
  await t.step("main task attempt 3 - success", async () => {
    await callTool<BudgetResult>(PMBudgetTool, { action: "add_attempt" });

    const check = await callTool<BudgetResult>(PMBudgetTool, { action: "check" });
    assertEquals(check.budget!.attemptsUsed, 3);
    // At limit but still within budget
    assertEquals(check.withinBudget, false); // Actually exceeds on 3rd
  });

  await t.step("budget report shows 3 attempts used", async () => {
    const report = await callTool<{ report: string }>(PMBudgetTool, {
      action: "report",
    });
    assertExists(report.report);
    assertEquals(report.report.includes("3"), true);
  });
});

/**
 * Scenario 5: Custom alternative added during handling
 *
 * Simulates:
 * 1. Pip install fails
 * 2. Predefined alternatives fail
 * 3. User suggests custom approach
 * 4. Custom approach succeeds
 */
Deno.test("PM SA Blocker Handling - Custom alternative added", async (t) => {
  resetAlternativeManager();

  await t.step("detect pip install failure", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "detect",
      error_message: "pip install torch failed with error: CUDA not found",
    });

    assertEquals(result.blockerType, "pip_install_failed");
  });

  await t.step("initialize predefined alternatives", async () => {
    await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "init",
      blocker_type: "pip_install_failed",
    });
  });

  await t.step("fail first predefined alternative", async () => {
    const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });

    await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "mark_failed",
      plan_id: nextResult.nextPlan!.id,
      failure_reason: "Mirror also failed",
    });
  });

  await t.step("add custom alternative", async () => {
    const result = await callTool<{ addedPlan: { id: string } }>(
      PMAlternativeTool,
      {
        action: "add",
        description: "Install PyTorch with CPU-only build",
        confidence: 0.95,
      },
    );

    assertExists(result.addedPlan);
  });

  await t.step("custom alternative has highest confidence", async () => {
    const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });

    // Custom plan (0.95) should be next since it has highest confidence
    assertEquals(
      nextResult.nextPlan!.description.includes("CPU-only"),
      true,
    );
  });

  await t.step("custom alternative succeeds", async () => {
    const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });

    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "mark_success",
      plan_id: nextResult.nextPlan!.id,
    });

    assertEquals(result.markedPlan!.result, "success");
  });
});

/**
 * Scenario 6: List action shows current state
 */
Deno.test("PM SA Blocker Handling - List action for debugging", async (t) => {
  resetAlternativeManager();

  await t.step("list returns empty initially", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "list",
    });

    assertEquals(result.alternatives!.length, 0);
  });

  await t.step("setup some state", async () => {
    await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "init",
      blocker_type: "disk_full",
    });

    const nextResult = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "next",
    });

    await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "mark_failed",
      plan_id: nextResult.nextPlan!.id,
    });
  });

  await t.step("list shows current state", async () => {
    const result = await callTool<AlternativeResult>(PMAlternativeTool, {
      action: "list",
    });

    assertExists(result.alternatives);
    assertGreater(result.alternatives!.length, 0);

    // Should show one tried (failed)
    assertEquals(result.isExhausted, false);
  });
});
