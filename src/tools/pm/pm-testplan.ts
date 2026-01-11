/**
 * PM TestPlan Tool - Find and generate tests for PM SA
 * Wraps test-finder and test-generator services
 */

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { testFinder, testGenerator } from "../../services/pm/mod.ts";
import { requirementsManager } from "../../services/pm/mod.ts";
import type { TestFramework } from "../../services/pm/mod.ts";

const inputSchema = z.object({
  action: z.enum(["find", "find_all", "generate", "detect_framework"]),
  keyword: z.string().optional().describe(
    "Keyword to search for in test files (required for find)",
  ),
  requirement_id: z.string().optional().describe(
    "Requirement ID to generate test for (required for generate)",
  ),
  framework: z.enum(["deno", "jest", "vitest", "mocha"]).optional().describe(
    "Test framework (optional, auto-detected if not specified)",
  ),
});

type Input = z.infer<typeof inputSchema>;

interface TestPlanOutput {
  tests?: Array<{
    id: string;
    type: string;
    path?: string;
    status: string;
  }>;
  template?: string;
  testPath?: string;
  framework?: TestFramework;
  error?: string;
}

/**
 * PMTestPlan - Test planning tool for PM SA
 *
 * Used by PM SA to:
 * - Find existing tests related to a feature
 * - Generate test templates for requirements
 * - Detect which test framework the project uses
 */
export const PMTestPlanTool: Tool<typeof inputSchema, TestPlanOutput> = {
  name: "PMTestPlan",
  description: `Manage test planning for PM verification.
Actions:
- find: Find existing tests by keyword
- find_all: Find all test files in the project
- generate: Generate test template for a requirement
- detect_framework: Auto-detect which test framework the project uses`,

  inputSchema,

  isReadOnly: () => true, // Doesn't modify filesystem (generates templates in memory)
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<TestPlanOutput>> {
    switch (input.action) {
      case "find": {
        if (!input.keyword) {
          yield {
            type: "result",
            data: { error: "keyword is required for find action" },
          };
          return;
        }

        const tests = await testFinder.findTests(input.keyword, context.cwd);
        yield {
          type: "result",
          data: {
            tests: tests.map((t) => ({
              id: t.id,
              type: t.type,
              path: t.path,
              status: t.status,
            })),
          },
          resultForAssistant: tests.length === 0
            ? `没有找到与 "${input.keyword}" 相关的测试文件`
            : `找到 ${tests.length} 个相关测试：\n${
              tests.map((t) => `- ${t.path}`).join("\n")
            }`,
        };
        break;
      }

      case "find_all": {
        const tests = await testFinder.findAllTests(context.cwd);
        yield {
          type: "result",
          data: {
            tests: tests.map((t) => ({
              id: t.id,
              type: t.type,
              path: t.path,
              status: t.status,
            })),
          },
          resultForAssistant: tests.length === 0
            ? "项目中没有找到测试文件"
            : `找到 ${tests.length} 个测试文件：\n${
              tests.slice(0, 10).map((t) => `- ${t.path}`).join("\n")
            }${tests.length > 10 ? `\n...还有 ${tests.length - 10} 个` : ""}`,
        };
        break;
      }

      case "generate": {
        if (!input.requirement_id) {
          yield {
            type: "result",
            data: { error: "requirement_id is required for generate action" },
          };
          return;
        }

        const req = requirementsManager.get(input.requirement_id);
        if (!req) {
          yield {
            type: "result",
            data: { error: `需求不存在: ${input.requirement_id}` },
          };
          return;
        }

        // Auto-detect or use provided framework
        const framework: TestFramework = input.framework ||
          await testGenerator.detectFramework(context.cwd);

        const testCase = testGenerator.generateTestTemplate(req, framework);
        const testPath = testGenerator.generateTestPath(
          req,
          framework,
          context.cwd,
        );

        yield {
          type: "result",
          data: {
            template: testCase.template,
            testPath,
            framework,
          },
          resultForAssistant:
            `已生成 ${framework} 测试模板\n建议保存到: ${testPath}\n\n\`\`\`typescript\n${testCase.template}\`\`\``,
        };
        break;
      }

      case "detect_framework": {
        const framework = await testGenerator.detectFramework(context.cwd);
        yield {
          type: "result",
          data: { framework },
          resultForAssistant: `检测到项目使用 ${framework} 测试框架`,
        };
        break;
      }
    }
  },

  renderResultForAssistant(output: TestPlanOutput): string {
    if (output.error) return `错误: ${output.error}`;
    if (output.template) return `测试模板已生成 (${output.framework})`;
    if (output.tests) return `${output.tests.length} 个测试`;
    if (output.framework) return `框架: ${output.framework}`;
    return "操作完成";
  },
};
