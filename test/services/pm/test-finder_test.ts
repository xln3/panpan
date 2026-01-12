/**
 * Tests for TestFinder
 */

import { assertEquals } from "@std/assert";
import { TestFinder } from "../../../src/services/pm/test-finder.ts";
import { createTempStructure, withTempDir } from "../../_helpers/mod.ts";

Deno.test("TestFinder - findTests returns empty array when no tests", async () => {
  await withTempDir(async (dir) => {
    const finder = new TestFinder();
    const tests = await finder.findTests("login", dir);

    assertEquals(tests.length, 0);
  });
});

Deno.test("TestFinder - findTests finds matching test files", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test": {
        "login_test.ts": "// login test",
        "auth_test.ts": "// auth test",
        "utils_test.ts": "// utils test",
      },
    });

    const finder = new TestFinder();
    const tests = await finder.findTests("login", dir);

    assertEquals(tests.length >= 1, true);
    assertEquals(tests.some((t) => t.path?.includes("login")), true);
  });
});

Deno.test("TestFinder - findTests searches multiple test directories", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test": {
        "feature_test.ts": "// test",
      },
      "__tests__": {
        "feature.test.ts": "// test",
      },
    });

    const finder = new TestFinder();
    const tests = await finder.findTests("feature", dir);

    assertEquals(tests.length >= 1, true);
  });
});

Deno.test("TestFinder - findAllTests returns all test files", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test": {
        "a_test.ts": "// test a",
        "b_test.ts": "// test b",
        "nested": {
          "c_test.ts": "// test c",
        },
      },
    });

    const finder = new TestFinder();
    const tests = await finder.findAllTests(dir);

    assertEquals(tests.length, 3);
  });
});

Deno.test("TestFinder - findAllTests returns empty for no test directory", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "src": {
        "main.ts": "// main",
      },
    });

    const finder = new TestFinder();
    const tests = await finder.findAllTests(dir);

    assertEquals(tests.length, 0);
  });
});

Deno.test("TestFinder - checkTestContent returns true for matching keyword", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test": {
        "login_test.ts": `
          Deno.test("login should work", () => {
            // test authentication flow
          });
        `,
      },
    });

    const finder = new TestFinder();
    const hasAuth = await finder.checkTestContent(
      `${dir}/test/login_test.ts`,
      ["authentication"],
    );

    assertEquals(hasAuth, true);
  });
});

Deno.test("TestFinder - checkTestContent returns false for non-matching keyword", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test": {
        "login_test.ts": "// simple test",
      },
    });

    const finder = new TestFinder();
    const hasPayment = await finder.checkTestContent(
      `${dir}/test/login_test.ts`,
      ["payment", "checkout"],
    );

    assertEquals(hasPayment, false);
  });
});

Deno.test("TestFinder - checkTestContent is case insensitive", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test": {
        "auth_test.ts": "// Test for AUTHENTICATION",
      },
    });

    const finder = new TestFinder();
    const hasAuth = await finder.checkTestContent(
      `${dir}/test/auth_test.ts`,
      ["authentication"],
    );

    assertEquals(hasAuth, true);
  });
});

Deno.test("TestFinder - getTestInfo returns exists true for existing file", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "test": {
        "sample_test.ts": "// test content here",
      },
    });

    const finder = new TestFinder();
    const info = await finder.getTestInfo(`${dir}/test/sample_test.ts`);

    assertEquals(info.exists, true);
    assertEquals(typeof info.size, "number");
    assertEquals(info.size! > 0, true);
  });
});

Deno.test("TestFinder - getTestInfo returns exists false for non-existing file", async () => {
  const finder = new TestFinder();
  const info = await finder.getTestInfo("/non/existing/path_test.ts");

  assertEquals(info.exists, false);
  assertEquals(info.size, undefined);
});
