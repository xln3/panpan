/**
 * Tests for AlternativeManager service
 *
 * These tests verify the core functionality of the alternative management system
 * that enables PM SA to automatically try fallback approaches when blocked.
 */

import { assertEquals, assertExists, assertGreater } from "@std/assert";
import {
  AlternativeManager,
  COMMON_ALTERNATIVES,
} from "../../../src/services/pm/alternative-manager.ts";

Deno.test("AlternativeManager - detectBlockerType identifies network errors", async (t) => {
  const manager = new AlternativeManager();

  await t.step("detects HuggingFace connection failures", () => {
    const cases = [
      "Failed to connect to huggingface.co: Network unreachable",
      "HTTPSConnectionPool(host='hf.co'): Connection refused",
      "OSError: huggingface.co timed out",
      "Network is unreachable when accessing huggingface",
    ];

    for (const error of cases) {
      assertEquals(
        manager.detectBlockerType(error),
        "huggingface_blocked",
        `Should detect HuggingFace blocker for: ${error}`,
      );
    }
  });

  await t.step("detects Google Drive failures", () => {
    const cases = [
      "HTTPSConnectionPool(host='drive.google.com'): Max retries exceeded",
      "Failed to download from Google Drive: Permission denied",
      "gdown error: Could not fetch file",
    ];

    for (const error of cases) {
      assertEquals(
        manager.detectBlockerType(error),
        "google_drive_blocked",
        `Should detect Google Drive blocker for: ${error}`,
      );
    }
  });

  await t.step("detects GitHub clone failures", () => {
    const cases = [
      "git clone https://github.com/foo/bar failed: Connection refused",
      "Failed to connect to github.com port 443",
      "fatal: unable to access 'https://github.com/...'",
    ];

    for (const error of cases) {
      assertEquals(
        manager.detectBlockerType(error),
        "github_blocked",
        `Should detect GitHub blocker for: ${error}`,
      );
    }
  });

  await t.step("detects pip installation failures", () => {
    const cases = [
      "pip install failed with error: Could not build wheel",
      "ERROR: pip install torch failed",
      "pip install error: No matching distribution found",
    ];

    for (const error of cases) {
      assertEquals(
        manager.detectBlockerType(error),
        "pip_install_failed",
        `Should detect pip blocker for: ${error}`,
      );
    }
  });

  await t.step("detects conda failures", () => {
    const cases = [
      "CondaError: conda install failed",
      "conda PackagesNotFoundError: The following packages are not available",
      "ResolvePackageNotFound: conda failed to resolve",
    ];

    for (const error of cases) {
      assertEquals(
        manager.detectBlockerType(error),
        "conda_failed",
        `Should detect conda blocker for: ${error}`,
      );
    }
  });

  await t.step("detects disk space issues", () => {
    const cases = [
      "OSError: [Errno 28] No space left on device",
      "ENOSPC: disk is full, cannot write",
      "Error: disk full - no space available",
    ];

    for (const error of cases) {
      assertEquals(
        manager.detectBlockerType(error),
        "disk_full",
        `Should detect disk blocker for: ${error}`,
      );
    }
  });

  await t.step("detects permission issues", () => {
    const cases = [
      "PermissionError: [Errno 13] Permission denied",
      "EACCES: permission denied, open '/etc/passwd'",
      "Error: Operation not permitted",
    ];

    for (const error of cases) {
      assertEquals(
        manager.detectBlockerType(error),
        "permission_denied",
        `Should detect permission blocker for: ${error}`,
      );
    }
  });

  await t.step("returns null for unrecognized errors", () => {
    const cases = [
      "TypeError: undefined is not a function",
      "SyntaxError: Unexpected token",
      "ReferenceError: foo is not defined",
      "Some random application error",
    ];

    for (const error of cases) {
      assertEquals(
        manager.detectBlockerType(error),
        null,
        `Should return null for: ${error}`,
      );
    }
  });
});

Deno.test("AlternativeManager - initForBlocker returns sorted alternatives", async (t) => {
  const manager = new AlternativeManager();

  await t.step("returns alternatives sorted by confidence descending", () => {
    const alternatives = manager.initForBlocker("huggingface_blocked");

    assertGreater(alternatives.length, 0);

    // Verify sorted by confidence descending
    for (let i = 1; i < alternatives.length; i++) {
      assertEquals(
        alternatives[i - 1].confidence >= alternatives[i].confidence,
        true,
        `Alternative ${i - 1} (${alternatives[i - 1].confidence}) should have >= confidence than ${i} (${alternatives[i].confidence})`,
      );
    }
  });

  await t.step("each alternative has required fields", () => {
    const alternatives = manager.initForBlocker("pip_install_failed");

    for (const alt of alternatives) {
      assertExists(alt.id, "Alternative should have id");
      assertExists(alt.description, "Alternative should have description");
      assertEquals(typeof alt.confidence, "number", "Confidence should be number");
      assertEquals(alt.confidence >= 0 && alt.confidence <= 1, true, "Confidence should be 0-1");
    }
  });

  await t.step("returns empty array for unknown blocker type", () => {
    const alternatives = manager.initForBlocker("unknown_blocker_type");
    assertEquals(alternatives.length, 0);
  });

  await t.step("all predefined blocker types have alternatives", () => {
    for (const blockerType of Object.keys(COMMON_ALTERNATIVES)) {
      const alternatives = manager.initForBlocker(blockerType);
      assertGreater(
        alternatives.length,
        0,
        `${blockerType} should have at least one alternative`,
      );
      manager.clear();
    }
  });
});

Deno.test("AlternativeManager - try-mark-next cycle works correctly", async (t) => {
  const manager = new AlternativeManager();
  manager.initForBlocker("huggingface_blocked");

  const triedIds: string[] = [];

  await t.step("getNextUntried returns highest confidence first", () => {
    const first = manager.getNextUntried();
    assertExists(first);
    triedIds.push(first.id);

    // First should have highest confidence
    const allPlans = manager.listPlans();
    const maxConfidence = Math.max(...allPlans.map((p) => p.confidence));
    assertEquals(first.confidence, maxConfidence);
  });

  await t.step("markTried records failure with reason", () => {
    manager.markTried(triedIds[0], "failed", "Mirror site also blocked");

    const plans = manager.listPlans();
    const marked = plans.find((p) => p.id === triedIds[0]);

    assertExists(marked);
    assertExists(marked.triedAt);
    assertEquals(marked.result, "failed");
    assertEquals(marked.failureReason, "Mirror site also blocked");
  });

  await t.step("getNextUntried skips tried plans", () => {
    const second = manager.getNextUntried();
    assertExists(second);
    assertEquals(triedIds.includes(second.id), false, "Should not return already tried plan");
    triedIds.push(second.id);
  });

  await t.step("markTried records success", () => {
    manager.markTried(triedIds[1], "success");

    const successPlan = manager.getSuccessfulPlan();
    assertExists(successPlan);
    assertEquals(successPlan.id, triedIds[1]);
  });

  await t.step("isExhausted is false when untried plans exist", () => {
    assertEquals(manager.isExhausted(), false);
  });
});

Deno.test("AlternativeManager - exhaustion detection", async (t) => {
  const manager = new AlternativeManager();

  // Use permission_denied which has fewer alternatives (3)
  manager.initForBlocker("permission_denied");
  const total = manager.listPlans().length;

  await t.step("initially not exhausted", () => {
    assertEquals(manager.isExhausted(), false);
  });

  await t.step("fail all alternatives", () => {
    for (let i = 0; i < total; i++) {
      const next = manager.getNextUntried();
      assertExists(next, `Should have untried plan at iteration ${i}`);
      manager.markTried(next.id, "failed", `Attempt ${i + 1} failed`);
    }
  });

  await t.step("exhausted after all failed", () => {
    assertEquals(manager.isExhausted(), true);
    assertEquals(manager.getNextUntried(), null);
    assertEquals(manager.getSuccessfulPlan(), null);
  });

  await t.step("getTriedPlans returns all plans", () => {
    const tried = manager.getTriedPlans();
    assertEquals(tried.length, total);
    assertEquals(tried.every((p) => p.result === "failed"), true);
  });
});

Deno.test("AlternativeManager - custom alternatives", async (t) => {
  const manager = new AlternativeManager();

  await t.step("addPlan creates custom alternative", () => {
    const plan = manager.addPlan("Try a completely custom approach", 0.65);

    assertExists(plan.id);
    assertEquals(plan.description, "Try a completely custom approach");
    assertEquals(plan.confidence, 0.65);
  });

  await t.step("custom plan appears in list", () => {
    const plans = manager.listPlans();
    const custom = plans.find((p) => p.description.includes("custom approach"));
    assertExists(custom);
  });

  await t.step("can mix predefined and custom alternatives", () => {
    manager.initForBlocker("github_blocked");
    manager.addPlan("Ask colleague for the repo", 0.3);

    const plans = manager.listPlans();
    const predefinedCount = COMMON_ALTERNATIVES["github_blocked"].length;

    // Should have predefined + 1 custom (but init clears previous)
    assertEquals(plans.length, predefinedCount + 1);
  });
});

Deno.test("AlternativeManager - generateReport output", async (t) => {
  const manager = new AlternativeManager();
  manager.initForBlocker("huggingface_blocked");

  await t.step("report includes blocker type", () => {
    const report = manager.generateReport();
    assertEquals(report.includes("huggingface_blocked"), true);
  });

  await t.step("report shows untried plans initially", () => {
    const report = manager.generateReport();
    assertEquals(report.includes("未尝试"), true);
    assertEquals(report.includes("⏳"), true);
  });

  // Try and fail first plan
  const first = manager.getNextUntried()!;
  manager.markTried(first.id, "failed", "Connection timeout");

  await t.step("report shows failed attempts with reason", () => {
    const report = manager.generateReport();
    assertEquals(report.includes("已尝试"), true);
    assertEquals(report.includes("❌"), true);
    assertEquals(report.includes("Connection timeout"), true);
  });

  // Succeed on second plan
  const second = manager.getNextUntried()!;
  manager.markTried(second.id, "success");

  await t.step("report highlights successful plan", () => {
    const report = manager.generateReport();
    assertEquals(report.includes("✅"), true);
    assertEquals(report.includes("成功方案"), true);
  });
});

Deno.test("AlternativeManager - clear resets state", async (t) => {
  const manager = new AlternativeManager();

  await t.step("setup state", () => {
    manager.initForBlocker("disk_full");
    const first = manager.getNextUntried()!;
    manager.markTried(first.id, "failed");
    assertEquals(manager.listPlans().length > 0, true);
  });

  await t.step("clear removes all plans", () => {
    manager.clear();
    assertEquals(manager.listPlans().length, 0);
    assertEquals(manager.isExhausted(), true); // Empty = exhausted
    assertEquals(manager.getNextUntried(), null);
  });
});

Deno.test("AlternativeManager - real-world scenario simulation", async (t) => {
  /**
   * Simulate a real scenario:
   * 1. HuggingFace download fails
   * 2. Try hf-mirror (fails)
   * 3. Try ModelScope (fails)
   * 4. Try local download + SCP (succeeds)
   */
  const manager = new AlternativeManager();

  await t.step("detect blocker from real error", () => {
    const error = `OSError: We couldn't connect to 'https://huggingface.co' to load this file,
    couldn't find it in the cached files and it looks like stabilityai/sd-turbo is not
    the path to a directory containing a file named config.json.`;

    const blockerType = manager.detectBlockerType(error);
    assertEquals(blockerType, "huggingface_blocked");
  });

  await t.step("initialize alternatives", () => {
    const alternatives = manager.initForBlocker("huggingface_blocked");
    assertGreater(alternatives.length, 2, "Should have multiple alternatives");
  });

  await t.step("simulate trying alternatives", () => {
    // Attempt 1: hf-mirror (fails)
    const plan1 = manager.getNextUntried()!;
    manager.markTried(plan1.id, "failed", "Mirror also blocked by firewall");

    // Attempt 2: ModelScope (fails)
    const plan2 = manager.getNextUntried()!;
    manager.markTried(plan2.id, "failed", "Model not available on ModelScope");

    // Attempt 3: Local download + SCP (succeeds)
    const plan3 = manager.getNextUntried()!;
    manager.markTried(plan3.id, "success");

    assertEquals(manager.getSuccessfulPlan()!.id, plan3.id);
  });

  await t.step("final report shows complete history", () => {
    const report = manager.generateReport();

    // Should show 2 failures and at least 1 success marker (might be in header + in list)
    assertEquals((report.match(/❌/g) || []).length, 2);
    assertGreater((report.match(/✅/g) || []).length, 0);
    assertEquals(report.includes("成功方案"), true);
    assertEquals(report.includes("Mirror also blocked"), true);
    assertEquals(report.includes("not available on ModelScope"), true);
  });
});
