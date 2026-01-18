/**
 * Tests for PMAlternative tool
 */

import { assertEquals, assertExists } from "@std/assert";
import { PMAlternativeTool, resetAlternativeManager } from "../../src/tools/pm/mod.ts";
import { collectGenerator } from "../_helpers/async-generator.ts";
import { createMockToolContext } from "../_helpers/mock-context.ts";

interface AlternativeResult {
  blockerType?: string | null;
  availableTypes?: string[];
  alternatives?: Array<{
    id: string;
    description: string;
    confidence: number;
    triedAt?: number;
    result?: string;
    failureReason?: string;
  }>;
  nextPlan?: {
    id: string;
    description: string;
    confidence: number;
  } | null;
  addedPlan?: {
    id: string;
    description: string;
    confidence: number;
  };
  markedPlan?: {
    id: string;
    result: string;
  };
  isExhausted?: boolean;
  successfulPlan?: { id: string } | null;
  report?: string;
  error?: string;
}

async function callPMAlternative(
  action: string,
  options: Record<string, unknown> = {},
): Promise<AlternativeResult> {
  const context = createMockToolContext();
  const results = await collectGenerator(
    PMAlternativeTool.call({ action, ...options } as never, context),
  );
  const lastResult = results[results.length - 1];
  if (lastResult && "data" in lastResult) {
    return lastResult.data as AlternativeResult;
  }
  return {};
}

Deno.test("PMAlternative - detect blocker type from error message", async (t) => {
  resetAlternativeManager();

  await t.step("detects HuggingFace blocked", async () => {
    const result = await callPMAlternative("detect", {
      error_message: "Failed to connect to huggingface.co: Network unreachable",
    });

    assertEquals(result.blockerType, "huggingface_blocked");
    assertExists(result.availableTypes);
  });

  await t.step("detects GitHub blocked", async () => {
    const result = await callPMAlternative("detect", {
      error_message: "git clone https://github.com/foo/bar failed: Connection refused",
    });

    assertEquals(result.blockerType, "github_blocked");
  });

  await t.step("detects Google Drive blocked", async () => {
    const result = await callPMAlternative("detect", {
      error_message: "HTTPSConnectionPool(host='drive.google.com'): Max retries exceeded",
    });

    assertEquals(result.blockerType, "google_drive_blocked");
  });

  await t.step("detects pip install failure", async () => {
    const result = await callPMAlternative("detect", {
      error_message: "pip install failed with error: Could not build wheel",
    });

    assertEquals(result.blockerType, "pip_install_failed");
  });

  await t.step("returns null for unknown errors", async () => {
    const result = await callPMAlternative("detect", {
      error_message: "Some random error that doesn't match any pattern",
    });

    assertEquals(result.blockerType, null);
  });

  resetAlternativeManager();
});

Deno.test("PMAlternative - initialize alternatives for blocker", async (t) => {
  resetAlternativeManager();

  await t.step("initializes alternatives for huggingface_blocked", async () => {
    const result = await callPMAlternative("init", {
      blocker_type: "huggingface_blocked",
    });

    assertExists(result.alternatives);
    assertEquals(result.alternatives!.length > 0, true);
    // Should be sorted by confidence
    for (let i = 1; i < result.alternatives!.length; i++) {
      assertEquals(
        result.alternatives![i - 1].confidence >= result.alternatives![i].confidence,
        true,
        "Alternatives should be sorted by confidence descending",
      );
    }
  });

  await t.step("returns error for unknown blocker type", async () => {
    const result = await callPMAlternative("init", {
      blocker_type: "unknown_type",
    });

    assertExists(result.error);
  });

  resetAlternativeManager();
});

Deno.test("PMAlternative - full workflow: try alternatives until success", async (t) => {
  resetAlternativeManager();

  await t.step("initialize alternatives", async () => {
    await callPMAlternative("init", { blocker_type: "huggingface_blocked" });
  });

  await t.step("get first alternative (highest confidence)", async () => {
    const result = await callPMAlternative("next");

    assertExists(result.nextPlan);
    assertEquals(result.isExhausted, false);
  });

  let firstPlanId: string;
  await t.step("mark first alternative as failed", async () => {
    // Get the plan first
    const nextResult = await callPMAlternative("next");
    firstPlanId = nextResult.nextPlan!.id;

    const result = await callPMAlternative("mark_failed", {
      plan_id: firstPlanId,
      failure_reason: "Mirror also blocked",
    });

    assertEquals(result.markedPlan!.result, "failed");
    assertEquals(result.isExhausted, false); // Still have more alternatives
  });

  await t.step("get second alternative", async () => {
    const result = await callPMAlternative("next");

    assertExists(result.nextPlan);
    // Should be different from first plan
    assertEquals(result.nextPlan!.id !== firstPlanId, true);
  });

  await t.step("mark second alternative as success", async () => {
    const nextResult = await callPMAlternative("next");
    const secondPlanId = nextResult.nextPlan!.id;

    const result = await callPMAlternative("mark_success", {
      plan_id: secondPlanId,
    });

    assertEquals(result.markedPlan!.result, "success");
    assertExists(result.successfulPlan);
  });

  await t.step("generate report shows all attempts", async () => {
    const result = await callPMAlternative("report");

    assertExists(result.report);
    assertEquals(result.report!.includes("成功方案"), true);
    assertEquals(result.report!.includes("已尝试"), true);
  });

  resetAlternativeManager();
});

Deno.test("PMAlternative - exhaust all alternatives", async (t) => {
  resetAlternativeManager();

  await t.step("initialize with small set (permission_denied has 3)", async () => {
    const result = await callPMAlternative("init", {
      blocker_type: "permission_denied",
    });

    assertExists(result.alternatives);
  });

  await t.step("fail all alternatives", async () => {
    // Keep trying and failing until exhausted
    let exhausted = false;
    let attempts = 0;
    const maxAttempts = 10; // Safety limit

    while (!exhausted && attempts < maxAttempts) {
      const nextResult = await callPMAlternative("next");

      if (nextResult.isExhausted) {
        exhausted = true;
        break;
      }

      if (nextResult.nextPlan) {
        await callPMAlternative("mark_failed", {
          plan_id: nextResult.nextPlan.id,
          failure_reason: `Attempt ${attempts + 1} failed`,
        });
      }

      attempts++;
    }

    assertEquals(exhausted, true);
  });

  await t.step("report shows all failed", async () => {
    const result = await callPMAlternative("report");

    assertExists(result.report);
    assertEquals(result.report!.includes("所有备选方案已耗尽"), true);
  });

  resetAlternativeManager();
});

Deno.test("PMAlternative - add custom alternative", async (t) => {
  resetAlternativeManager();

  await t.step("add custom plan", async () => {
    const result = await callPMAlternative("add", {
      description: "Use a custom workaround",
      confidence: 0.75,
    });

    assertExists(result.addedPlan);
    assertEquals(result.addedPlan!.description, "Use a custom workaround");
    assertEquals(result.addedPlan!.confidence, 0.75);
  });

  await t.step("custom plan appears in list", async () => {
    const result = await callPMAlternative("list");

    assertExists(result.alternatives);
    const customPlan = result.alternatives!.find((a) =>
      a.description.includes("custom workaround")
    );
    assertExists(customPlan);
  });

  resetAlternativeManager();
});
