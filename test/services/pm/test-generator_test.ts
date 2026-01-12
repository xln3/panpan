/**
 * Tests for TestGenerator
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { TestGenerator } from "../../../src/services/pm/test-generator.ts";
import { createTempStructure, withTempDir } from "../../_helpers/mod.ts";
import type { Requirement } from "../../../src/types/pm.ts";

function createMockRequirement(
  overrides: Partial<Requirement> = {},
): Requirement {
  return {
    id: "test-req-1",
    original: "实现用户登录功能",
    clarified: "实现用户登录功能，支持用户名密码验证",
    status: "clarified",
    questions: [],
    acceptance: ["登录成功返回 token", "密码错误返回 401"],
    ...overrides,
  };
}

Deno.test("TestGenerator - generateTestTemplate returns Deno template by default", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement();

  const testCase = generator.generateTestTemplate(req);

  assertEquals(testCase.type, "generated");
  assertEquals(testCase.requirementId, req.id);
  assertStringIncludes(testCase.template!, "Deno.test");
  assertStringIncludes(testCase.template!, "assertEquals");
});

Deno.test("TestGenerator - generateTestTemplate generates Jest template", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement();

  const testCase = generator.generateTestTemplate(req, "jest");

  assertStringIncludes(testCase.template!, "describe");
  assertStringIncludes(testCase.template!, "it(");
  assertStringIncludes(testCase.template!, "expect");
});

Deno.test("TestGenerator - generateTestTemplate generates Vitest template", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement();

  const testCase = generator.generateTestTemplate(req, "vitest");

  assertStringIncludes(testCase.template!, "describe");
  assertStringIncludes(testCase.template!, "it(");
});

Deno.test("TestGenerator - generateTestTemplate generates Mocha template", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement();

  const testCase = generator.generateTestTemplate(req, "mocha");

  assertStringIncludes(testCase.template!, "describe");
  assertStringIncludes(testCase.template!, "function()");
  assertStringIncludes(testCase.template!, "chai");
});

Deno.test("TestGenerator - generateTestTemplate includes acceptance criteria as test cases", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement({
    acceptance: ["验证用户名格式", "验证密码强度", "验证登录成功"],
  });

  const testCase = generator.generateTestTemplate(req, "deno");

  assertStringIncludes(testCase.template!, "验证用户名格式");
  assertStringIncludes(testCase.template!, "验证密码强度");
  assertStringIncludes(testCase.template!, "验证登录成功");
});

Deno.test("TestGenerator - generateTestTemplate handles empty acceptance", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement({ acceptance: [] });

  const testCase = generator.generateTestTemplate(req, "deno");

  assertStringIncludes(testCase.template!, "should meet requirements");
});

Deno.test("TestGenerator - generateTestTemplate escapes special characters", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement({
    clarified: 'Test with "quotes" and \\backslashes',
    acceptance: ['Check "special" chars'],
  });

  const testCase = generator.generateTestTemplate(req, "deno");

  // Should not have unescaped quotes that would break the template
  assertEquals(testCase.template!.includes('\\"quotes\\"'), true);
});

Deno.test("TestGenerator - detectFramework returns deno for deno.json", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "deno.json": JSON.stringify({ tasks: { test: "deno test" } }),
    });

    const generator = new TestGenerator();
    const framework = await generator.detectFramework(dir);

    assertEquals(framework, "deno");
  });
});

Deno.test("TestGenerator - detectFramework returns deno for deno.jsonc", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "deno.jsonc": "// Deno config\n{}",
    });

    const generator = new TestGenerator();
    const framework = await generator.detectFramework(dir);

    assertEquals(framework, "deno");
  });
});

Deno.test("TestGenerator - detectFramework returns jest for jest dependency", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "package.json": JSON.stringify({
        devDependencies: { jest: "^29.0.0" },
      }),
    });

    const generator = new TestGenerator();
    const framework = await generator.detectFramework(dir);

    assertEquals(framework, "jest");
  });
});

Deno.test("TestGenerator - detectFramework returns vitest for vitest dependency", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "package.json": JSON.stringify({
        devDependencies: { vitest: "^1.0.0" },
      }),
    });

    const generator = new TestGenerator();
    const framework = await generator.detectFramework(dir);

    assertEquals(framework, "vitest");
  });
});

Deno.test("TestGenerator - detectFramework returns mocha for mocha dependency", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "package.json": JSON.stringify({
        devDependencies: { mocha: "^10.0.0" },
      }),
    });

    const generator = new TestGenerator();
    const framework = await generator.detectFramework(dir);

    assertEquals(framework, "mocha");
  });
});

Deno.test("TestGenerator - detectFramework defaults to deno", async () => {
  await withTempDir(async (dir) => {
    // Empty directory
    const generator = new TestGenerator();
    const framework = await generator.detectFramework(dir);

    assertEquals(framework, "deno");
  });
});

Deno.test("TestGenerator - generateTestPath creates correct Deno path", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement({ id: "req-login-123" });

  const path = generator.generateTestPath(req, "deno", "/project");

  assertEquals(path, "/project/test/req-login-123_test.ts");
});

Deno.test("TestGenerator - generateTestPath creates correct Jest path", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement({ id: "req-auth" });

  const path = generator.generateTestPath(req, "jest", "/project");

  assertEquals(path, "/project/__tests__/req-auth.test.js");
});

Deno.test("TestGenerator - generateTestPath creates correct Vitest path", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement({ id: "req-cache" });

  const path = generator.generateTestPath(req, "vitest", "/project");

  assertEquals(path, "/project/test/req-cache.test.ts");
});

Deno.test("TestGenerator - generateTestPath creates correct Mocha path", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement({ id: "req-api" });

  const path = generator.generateTestPath(req, "mocha", "/project");

  assertEquals(path, "/project/test/req-api.spec.js");
});

Deno.test("TestGenerator - generateTestPath sanitizes special characters in ID", () => {
  const generator = new TestGenerator();
  const req = createMockRequirement({ id: "req/with:special@chars" });

  const path = generator.generateTestPath(req, "deno", "/project");

  assertEquals(path.includes("/"), true);
  assertEquals(path.includes(":"), false);
  assertEquals(path.includes("@"), false);
});
