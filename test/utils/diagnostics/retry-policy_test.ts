/**
 * Tests for diagnostics module - retry policy and withRetry
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  applyFix,
  createRetryContext,
  getRetrySummary,
  type RetryConfig,
  shouldRetry,
  updateRetryContext,
  withRetry,
} from "../../../src/utils/diagnostics/retry-policy.ts";
import type { ErrorDiagnosis, Fix } from "../../../src/types/diagnostics.ts";

// ============ createRetryContext Tests ============

Deno.test("createRetryContext - creates fresh context", () => {
  const ctx = createRetryContext();
  assertEquals(ctx.attempt, 0);
  assertEquals(ctx.appliedFixes, []);
  assertEquals(ctx.totalDurationMs, 0);
  assertEquals(ctx.lastDiagnosis, undefined);
});

// ============ shouldRetry Tests ============

Deno.test("shouldRetry - returns false when max attempts reached", () => {
  const ctx = { attempt: 3, appliedFixes: [], totalDurationMs: 0 };
  const diagnosis: ErrorDiagnosis = {
    type: "timeout",
    autoFixable: true,
    suggestedFixes: [{
      id: "fix1",
      description: "Fix 1",
      confidence: 0.8,
      action: { type: "set_env", key: "K", value: "V" },
    }],
    requiresUserInput: false,
  };
  const config: RetryConfig = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  };

  const result = shouldRetry(ctx, diagnosis, config);
  assertEquals(result.shouldRetry, false);
});

Deno.test("shouldRetry - returns false when not auto-fixable", () => {
  const ctx = createRetryContext();
  const diagnosis: ErrorDiagnosis = {
    type: "permission",
    autoFixable: false,
    suggestedFixes: [],
    requiresUserInput: true,
  };

  const result = shouldRetry(ctx, diagnosis);
  assertEquals(result.shouldRetry, false);
});

Deno.test("shouldRetry - returns false when no untried fixes", () => {
  const ctx = { attempt: 1, appliedFixes: ["fix1"], totalDurationMs: 100 };
  const diagnosis: ErrorDiagnosis = {
    type: "timeout",
    autoFixable: true,
    suggestedFixes: [{
      id: "fix1",
      description: "Fix 1",
      confidence: 0.8,
      action: { type: "set_env", key: "K", value: "V" },
    }],
    requiresUserInput: false,
  };

  const result = shouldRetry(ctx, diagnosis);
  assertEquals(result.shouldRetry, false);
});

Deno.test("shouldRetry - returns true with next fix when available", () => {
  const ctx = createRetryContext();
  const fix: Fix = {
    id: "fix1",
    description: "Fix 1",
    confidence: 0.8,
    action: { type: "set_env", key: "K", value: "V" },
  };
  const diagnosis: ErrorDiagnosis = {
    type: "timeout",
    autoFixable: true,
    suggestedFixes: [fix],
    requiresUserInput: false,
  };

  const result = shouldRetry(ctx, diagnosis);
  assertEquals(result.shouldRetry, true);
  assertEquals(result.nextFix, fix);
  assertEquals(result.delayMs, 1000); // default initialDelayMs
});

Deno.test("shouldRetry - calculates exponential backoff", () => {
  const ctx = {
    attempt: 2,
    appliedFixes: ["fix1", "fix2"],
    totalDurationMs: 200,
  };
  const fix: Fix = {
    id: "fix3",
    description: "Fix 3",
    confidence: 0.5,
    action: { type: "set_env", key: "K", value: "V" },
  };
  const diagnosis: ErrorDiagnosis = {
    type: "timeout",
    autoFixable: true,
    suggestedFixes: [
      {
        id: "fix1",
        description: "Fix 1",
        confidence: 0.9,
        action: { type: "set_env", key: "K", value: "V" },
      },
      {
        id: "fix2",
        description: "Fix 2",
        confidence: 0.7,
        action: { type: "set_env", key: "K", value: "V" },
      },
      fix,
    ],
    requiresUserInput: false,
  };
  const config: RetryConfig = {
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
  };

  const result = shouldRetry(ctx, diagnosis, config);
  assertEquals(result.shouldRetry, true);
  assertEquals(result.delayMs, 4000); // 1000 * 2^2
});

Deno.test("shouldRetry - respects maxDelayMs", () => {
  const ctx = { attempt: 5, appliedFixes: [], totalDurationMs: 0 };
  const diagnosis: ErrorDiagnosis = {
    type: "timeout",
    autoFixable: true,
    suggestedFixes: [{
      id: "fix1",
      description: "Fix 1",
      confidence: 0.8,
      action: { type: "set_env", key: "K", value: "V" },
    }],
    requiresUserInput: false,
  };
  const config: RetryConfig = {
    maxAttempts: 10,
    initialDelayMs: 1000,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
  };

  const result = shouldRetry(ctx, diagnosis, config);
  assertEquals(result.delayMs, 5000); // Capped at maxDelayMs
});

// ============ updateRetryContext Tests ============

Deno.test("updateRetryContext - increments attempt", () => {
  const ctx = createRetryContext();
  const fix: Fix = {
    id: "fix1",
    description: "Fix 1",
    confidence: 0.8,
    action: { type: "set_env", key: "K", value: "V" },
  };

  const updated = updateRetryContext(ctx, fix, 100);
  assertEquals(updated.attempt, 1);
});

Deno.test("updateRetryContext - adds fix to appliedFixes", () => {
  const ctx = createRetryContext();
  const fix: Fix = {
    id: "fix1",
    description: "Fix 1",
    confidence: 0.8,
    action: { type: "set_env", key: "K", value: "V" },
  };

  const updated = updateRetryContext(ctx, fix, 100);
  assertEquals(updated.appliedFixes, ["fix1"]);
});

Deno.test("updateRetryContext - accumulates duration", () => {
  let ctx = createRetryContext();
  const fix1: Fix = {
    id: "fix1",
    description: "Fix 1",
    confidence: 0.8,
    action: { type: "set_env", key: "K", value: "V" },
  };
  const fix2: Fix = {
    id: "fix2",
    description: "Fix 2",
    confidence: 0.7,
    action: { type: "set_env", key: "K", value: "V" },
  };

  ctx = updateRetryContext(ctx, fix1, 100);
  ctx = updateRetryContext(ctx, fix2, 200);

  assertEquals(ctx.totalDurationMs, 300);
});

// ============ getRetrySummary Tests ============

Deno.test("getRetrySummary - returns 'no retry' for fresh context", () => {
  const ctx = createRetryContext();
  assertEquals(getRetrySummary(ctx), "未进行重试");
});

Deno.test("getRetrySummary - includes attempt count and fixes", () => {
  const ctx = {
    attempt: 2,
    appliedFixes: ["use_mirror", "increase_timeout"],
    totalDurationMs: 5000,
  };
  const summary = getRetrySummary(ctx);
  assertEquals(summary.includes("2"), true);
  assertEquals(summary.includes("use_mirror"), true);
  assertEquals(summary.includes("increase_timeout"), true);
});

// ============ applyFix Tests ============

Deno.test("applyFix - sets environment variable for set_env action", () => {
  const originalValue = Deno.env.get("TEST_APPLY_FIX_VAR");
  try {
    const fix: Fix = {
      id: "test-fix",
      description: "Test",
      confidence: 1,
      action: {
        type: "set_env",
        key: "TEST_APPLY_FIX_VAR",
        value: "test-value",
      },
    };

    applyFix(fix);

    assertEquals(Deno.env.get("TEST_APPLY_FIX_VAR"), "test-value");
    assertEquals(Deno.env.get("test_apply_fix_var"), "test-value"); // lowercase variant
  } finally {
    if (originalValue) {
      Deno.env.set("TEST_APPLY_FIX_VAR", originalValue);
    } else {
      Deno.env.delete("TEST_APPLY_FIX_VAR");
      Deno.env.delete("test_apply_fix_var");
    }
  }
});

Deno.test("applyFix - sets MIRROR_URL for use_mirror action", () => {
  const originalValue = Deno.env.get("MIRROR_URL");
  try {
    const fix: Fix = {
      id: "test-fix",
      description: "Test",
      confidence: 1,
      action: { type: "use_mirror", url: "https://mirror.example.com" },
    };

    applyFix(fix);

    assertEquals(Deno.env.get("MIRROR_URL"), "https://mirror.example.com");
  } finally {
    if (originalValue) {
      Deno.env.set("MIRROR_URL", originalValue);
    } else {
      Deno.env.delete("MIRROR_URL");
    }
  }
});

Deno.test("applyFix - sets pip env vars for pip tool", () => {
  const originalIndex = Deno.env.get("PIP_INDEX_URL");
  const originalHost = Deno.env.get("PIP_TRUSTED_HOST");
  try {
    const fix: Fix = {
      id: "test-fix",
      description: "Test",
      confidence: 1,
      action: {
        type: "use_mirror",
        url: "https://pypi.tuna.tsinghua.edu.cn/simple",
      },
    };

    applyFix(fix, { tool: "pip" });

    assertEquals(
      Deno.env.get("PIP_INDEX_URL"),
      "https://pypi.tuna.tsinghua.edu.cn/simple",
    );
    assertEquals(Deno.env.get("PIP_TRUSTED_HOST"), "pypi.tuna.tsinghua.edu.cn");
  } finally {
    if (originalIndex) Deno.env.set("PIP_INDEX_URL", originalIndex);
    else Deno.env.delete("PIP_INDEX_URL");
    if (originalHost) Deno.env.set("PIP_TRUSTED_HOST", originalHost);
    else Deno.env.delete("PIP_TRUSTED_HOST");
  }
});

// ============ withRetry Tests ============

Deno.test("withRetry - returns success on first try", async () => {
  let callCount = 0;

  const { result, success, retryContext } = await withRetry(
    async () => {
      await Promise.resolve();
      callCount++;
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  );

  assertEquals(success, true);
  assertEquals(result.exitCode, 0);
  assertEquals(callCount, 1);
  assertEquals(retryContext.attempt, 0);
});

Deno.test("withRetry - retries on failure with fix", async () => {
  let callCount = 0;

  const { result, success, retryContext } = await withRetry(
    async () => {
      await Promise.resolve();
      callCount++;
      if (callCount === 1) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "ReadTimeoutError: timed out",
        };
      }
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
    {
      context: { tool: "pip" },
      config: {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      },
    },
  );

  assertEquals(success, true);
  assertEquals(result.exitCode, 0);
  assertEquals(callCount, 2);
  assertEquals(retryContext.attempt >= 1, true);
});

Deno.test("withRetry - respects max attempts", async () => {
  let callCount = 0;

  const { success, retryContext: _retryContext } = await withRetry(
    async () => {
      await Promise.resolve();
      callCount++;
      return { exitCode: 1, stdout: "", stderr: "ReadTimeoutError: timed out" };
    },
    {
      context: { tool: "pip" },
      config: {
        maxAttempts: 2,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      },
    },
  );

  assertEquals(success, false);
  // Call count depends on available fixes, but should be limited
  assertEquals(callCount <= 3, true);
});

Deno.test("withRetry - calls onRetry callback", async () => {
  const retryEvents: Array<{ attempt: number; fixId: string }> = [];

  await withRetry(
    async () => {
      await Promise.resolve();
      if (retryEvents.length === 0) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "ReadTimeoutError: timed out",
        };
      }
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
    {
      context: { tool: "pip" },
      config: {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      },
      onRetry: (fix, attempt) => {
        retryEvents.push({ attempt, fixId: fix.id });
      },
    },
  );

  assertEquals(retryEvents.length >= 1, true);
  assertExists(retryEvents[0].fixId);
});

Deno.test("withRetry - custom isFailed function", async () => {
  let callCount = 0;

  const { success } = await withRetry(
    async () => {
      await Promise.resolve();
      callCount++;
      // Returns exit code 0 but contains error in stdout
      return { exitCode: 0, stdout: "ERROR: something went wrong", stderr: "" };
    },
    {
      isFailed: (r) => r.stdout.includes("ERROR"),
      config: {
        maxAttempts: 1,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      },
    },
  );

  assertEquals(success, false);
});
