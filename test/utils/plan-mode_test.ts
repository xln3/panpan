/**
 * Tests for src/utils/plan-mode.ts
 */

import { assertEquals } from "@std/assert";
import {
  enterPlanMode,
  exitPlanMode,
  getPlanFilePath,
  isPlanFile,
  isPlanMode,
  isToolAllowedInPlanMode,
  PLAN_MODE_ALLOWED_TOOLS,
  readPlanFile,
} from "../../src/utils/plan-mode.ts";

// =============================================================================
// Helper to reset plan mode state between tests
// Must write enough content to plan file before exit can succeed
// =============================================================================

const LONG_CONTENT =
  "# Implementation Plan\n\nThis is a detailed implementation plan with enough content to pass the 50 character validation check.";

function resetPlanMode(): void {
  if (!isPlanMode()) return;

  // Write enough content to allow exit
  const path = getPlanFilePath();
  if (path) {
    try {
      Deno.writeTextFileSync(path, LONG_CONTENT);
    } catch {
      // File might not exist
    }
  }

  // Now exit should work
  exitPlanMode();
}

// =============================================================================
// isPlanMode tests
// =============================================================================

Deno.test("isPlanMode - returns false initially", () => {
  resetPlanMode();
  assertEquals(isPlanMode(), false);
});

Deno.test("isPlanMode - returns true after entering plan mode", () => {
  resetPlanMode();

  try {
    enterPlanMode();
    assertEquals(isPlanMode(), true);
  } finally {
    resetPlanMode();
  }
});

Deno.test("isPlanMode - returns false after exiting plan mode", () => {
  resetPlanMode();

  enterPlanMode();
  const path = getPlanFilePath()!;
  Deno.writeTextFileSync(path, LONG_CONTENT);
  exitPlanMode();

  assertEquals(isPlanMode(), false);
});

// =============================================================================
// enterPlanMode tests
// =============================================================================

Deno.test("enterPlanMode - creates plan file", () => {
  resetPlanMode();

  try {
    const { planFilePath } = enterPlanMode();

    // Check file exists
    const stat = Deno.statSync(planFilePath);
    assertEquals(stat.isFile, true);

    // Check file has initial content
    const content = Deno.readTextFileSync(planFilePath);
    assertEquals(content.includes("# Implementation Plan"), true);
  } finally {
    resetPlanMode();
  }
});

Deno.test("enterPlanMode - generates slug-based filename", () => {
  resetPlanMode();

  try {
    const { planFilePath } = enterPlanMode();

    // Path should end with .md and contain slug pattern
    assertEquals(planFilePath.endsWith(".md"), true);
    assertEquals(planFilePath.includes("-"), true);
  } finally {
    resetPlanMode();
  }
});

Deno.test("enterPlanMode - returns existing path if already enabled", () => {
  resetPlanMode();

  try {
    const first = enterPlanMode();
    const second = enterPlanMode();

    assertEquals(first.planFilePath, second.planFilePath);
  } finally {
    resetPlanMode();
  }
});

// =============================================================================
// exitPlanMode tests
// =============================================================================

Deno.test("exitPlanMode - returns error if not in plan mode", () => {
  resetPlanMode();

  const result = exitPlanMode();

  assertEquals("error" in result, true);
  assertEquals((result as { error: string }).error, "Not in plan mode");
});

Deno.test("exitPlanMode - returns error if plan file too short", () => {
  resetPlanMode();

  enterPlanMode();
  const path = getPlanFilePath()!;
  Deno.writeTextFileSync(path, "Too short");

  const result = exitPlanMode();

  assertEquals("error" in result, true);
  assertEquals(
    (result as { error: string }).error.includes("empty or too short"),
    true,
  );

  // Clean up - must write long content to exit
  Deno.writeTextFileSync(path, LONG_CONTENT);
  exitPlanMode();
});

Deno.test("exitPlanMode - returns plan content on success", () => {
  resetPlanMode();

  enterPlanMode();
  const path = getPlanFilePath()!;
  Deno.writeTextFileSync(path, LONG_CONTENT);

  const result = exitPlanMode();

  assertEquals("planContent" in result, true);
  assertEquals((result as { planContent: string }).planContent, LONG_CONTENT);
});

Deno.test("exitPlanMode - disables plan mode", () => {
  resetPlanMode();

  enterPlanMode();
  const path = getPlanFilePath()!;
  Deno.writeTextFileSync(path, LONG_CONTENT);
  exitPlanMode();

  assertEquals(isPlanMode(), false);
  assertEquals(getPlanFilePath(), null);
});

// =============================================================================
// getPlanFilePath tests
// =============================================================================

Deno.test("getPlanFilePath - returns null when not in plan mode", () => {
  resetPlanMode();
  assertEquals(getPlanFilePath(), null);
});

Deno.test("getPlanFilePath - returns path when in plan mode", () => {
  resetPlanMode();

  try {
    const { planFilePath } = enterPlanMode();
    assertEquals(getPlanFilePath(), planFilePath);
  } finally {
    resetPlanMode();
  }
});

// =============================================================================
// readPlanFile tests
// =============================================================================

Deno.test("readPlanFile - returns null when not in plan mode", () => {
  resetPlanMode();
  assertEquals(readPlanFile(), null);
});

Deno.test("readPlanFile - returns file content", () => {
  resetPlanMode();

  try {
    enterPlanMode();
    const path = getPlanFilePath()!;
    const content = LONG_CONTENT;
    Deno.writeTextFileSync(path, content);

    assertEquals(readPlanFile(), content);
  } finally {
    resetPlanMode();
  }
});

// =============================================================================
// isPlanFile tests
// =============================================================================

Deno.test("isPlanFile - returns false when not in plan mode", () => {
  resetPlanMode();
  assertEquals(isPlanFile("/some/path.md"), false);
});

Deno.test("isPlanFile - returns true for matching path", () => {
  resetPlanMode();

  try {
    const { planFilePath } = enterPlanMode();
    assertEquals(isPlanFile(planFilePath), true);
  } finally {
    resetPlanMode();
  }
});

Deno.test("isPlanFile - returns false for non-matching path", () => {
  resetPlanMode();

  try {
    enterPlanMode();
    assertEquals(isPlanFile("/other/path.md"), false);
  } finally {
    resetPlanMode();
  }
});

Deno.test("isPlanFile - normalizes path separators", () => {
  resetPlanMode();

  try {
    const { planFilePath } = enterPlanMode();
    // Convert forward slashes to backslashes
    const windowsPath = planFilePath.replace(/\//g, "\\");
    assertEquals(isPlanFile(windowsPath), true);
  } finally {
    resetPlanMode();
  }
});

// =============================================================================
// isToolAllowedInPlanMode tests
// =============================================================================

Deno.test("isToolAllowedInPlanMode - allows read-only tools", () => {
  assertEquals(isToolAllowedInPlanMode("Glob", true), true);
  assertEquals(isToolAllowedInPlanMode("Grep", true), true);
  assertEquals(isToolAllowedInPlanMode("FileRead", true), true);
  assertEquals(isToolAllowedInPlanMode("AnyTool", true), true);
});

Deno.test("isToolAllowedInPlanMode - allows TodoWrite", () => {
  assertEquals(isToolAllowedInPlanMode("TodoWrite", false), true);
});

Deno.test("isToolAllowedInPlanMode - allows ExitPlanMode", () => {
  assertEquals(isToolAllowedInPlanMode("ExitPlanMode", false), true);
});

Deno.test("isToolAllowedInPlanMode - allows Edit on plan file", () => {
  resetPlanMode();

  try {
    const { planFilePath } = enterPlanMode();
    assertEquals(isToolAllowedInPlanMode("Edit", false, planFilePath), true);
  } finally {
    resetPlanMode();
  }
});

Deno.test("isToolAllowedInPlanMode - blocks Edit on other files", () => {
  resetPlanMode();

  try {
    enterPlanMode();
    assertEquals(
      isToolAllowedInPlanMode("Edit", false, "/other/file.ts"),
      false,
    );
  } finally {
    resetPlanMode();
  }
});

Deno.test("isToolAllowedInPlanMode - blocks write tools", () => {
  assertEquals(isToolAllowedInPlanMode("FileWrite", false), false);
  assertEquals(isToolAllowedInPlanMode("Bash", false), false);
  assertEquals(isToolAllowedInPlanMode("Edit", false), false); // No filePath
});

Deno.test("PLAN_MODE_ALLOWED_TOOLS - contains expected tools", () => {
  assertEquals(PLAN_MODE_ALLOWED_TOOLS.has("TodoWrite"), true);
  assertEquals(PLAN_MODE_ALLOWED_TOOLS.has("ExitPlanMode"), true);
  assertEquals(PLAN_MODE_ALLOWED_TOOLS.size, 2);
});
