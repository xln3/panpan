# 模块 F: PM 服务

## 整体背景
> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

本模块实现 PMSA 的核心服务层，负责需求澄清、测试计划、验收循环和预算追踪。

## 设计要点
- **需求澄清**: 通过问答确认需求，排除歧义
- **测试计划**: 生成或查找测试模板
- **验收循环**: 自动重试 + 智能切换方案
- **预算追踪**: Token/时间限制，达到后通知

## 依赖关系
- **依赖**: 无（可立即开始）
- **类型依赖**: `src/types/pm.ts`
- **被依赖**: Sprint 2 的 tools/pm (J)

## 文件结构
```
src/services/pm/
├── mod.ts               # 统一导出
├── requirements.ts      # 需求解析和跟踪
├── test-finder.ts       # 查找现有测试
├── test-generator.ts    # 生成测试模板
├── verification.ts      # 验收循环
└── budget-tracker.ts    # 预算追踪
```

## 详细设计

### 1. src/services/pm/requirements.ts
```typescript
import type { Requirement, QA } from "../../types/pm.ts";

/**
 * 需求管理器
 */
export class RequirementsManager {
  private requirements = new Map<string, Requirement>();

  /**
   * 创建新需求
   */
  create(original: string): Requirement {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const requirement: Requirement = {
      id,
      original,
      clarified: original,
      acceptance: [],
      questions: [],
      status: "draft",
    };

    this.requirements.set(id, requirement);
    return requirement;
  }

  /**
   * 获取需求
   */
  get(id: string): Requirement | undefined {
    return this.requirements.get(id);
  }

  /**
   * 添加问答
   */
  addQA(id: string, question: string, answer: string): void {
    const req = this.requirements.get(id);
    if (!req) return;

    req.questions.push({
      question,
      answer,
      timestamp: Date.now(),
    });
  }

  /**
   * 更新澄清后的需求
   */
  updateClarified(id: string, clarified: string): void {
    const req = this.requirements.get(id);
    if (req) {
      req.clarified = clarified;
      req.status = "clarified";
    }
  }

  /**
   * 设置验收标准
   */
  setAcceptance(id: string, criteria: string[]): void {
    const req = this.requirements.get(id);
    if (req) {
      req.acceptance = criteria;
    }
  }

  /**
   * 更新状态
   */
  updateStatus(id: string, status: Requirement["status"]): void {
    const req = this.requirements.get(id);
    if (req) {
      req.status = status;
    }
  }

  /**
   * 生成需求澄清问题
   */
  generateClarifyingQuestions(requirement: Requirement): string[] {
    const questions: string[] = [];
    const text = requirement.original.toLowerCase();

    // 检测模糊词汇
    const vagueTerms = [
      { term: "快", question: "请具体说明 '快' 的标准是什么？（例如：响应时间 < 100ms）" },
      { term: "好", question: "请具体说明 '好' 的标准是什么？" },
      { term: "优化", question: "请说明优化的目标指标是什么？（例如：性能、内存、代码质量）" },
      { term: "改进", question: "请说明具体需要改进哪些方面？" },
      { term: "简单", question: "请说明 '简单' 是指代码简洁还是使用简单？" },
      { term: "安全", question: "请说明需要防范哪些安全威胁？" },
    ];

    for (const { term, question } of vagueTerms) {
      if (text.includes(term)) {
        questions.push(question);
      }
    }

    // 检测缺少的信息
    if (!text.includes("测试") && !text.includes("test")) {
      questions.push("是否需要编写测试？测试覆盖率要求是多少？");
    }

    if (!text.includes("错误") && !text.includes("error") && !text.includes("异常")) {
      questions.push("错误情况应该如何处理？");
    }

    // 至少返回一个问题
    if (questions.length === 0) {
      questions.push("请确认：这个需求的完成标志是什么？");
    }

    return questions.slice(0, 5); // 最多 5 个问题
  }

  /**
   * 从问答中提取验收标准
   */
  extractAcceptanceCriteria(requirement: Requirement): string[] {
    const criteria: string[] = [];

    // 从原始需求提取
    const original = requirement.original;
    if (original.includes("能够")) {
      criteria.push(`功能验证: ${original}`);
    }

    // 从问答中提取
    for (const qa of requirement.questions) {
      if (qa.answer.includes("是") || qa.answer.includes("需要")) {
        criteria.push(`确认: ${qa.question} → ${qa.answer}`);
      }
    }

    // 默认标准
    if (criteria.length === 0) {
      criteria.push("代码编译/运行无错误");
      criteria.push("符合原始需求描述");
    }

    return criteria;
  }

  /**
   * 列出所有需求
   */
  list(): Requirement[] {
    return Array.from(this.requirements.values());
  }
}

// 单例导出
export const requirementsManager = new RequirementsManager();
```

### 2. src/services/pm/test-finder.ts
```typescript
import type { TestCase } from "../../types/pm.ts";

/**
 * 测试文件查找器
 */
export class TestFinder {
  /**
   * 在项目中查找相关测试
   */
  async findTests(
    keyword: string,
    cwd: string = Deno.cwd()
  ): Promise<TestCase[]> {
    const tests: TestCase[] = [];

    // 常见测试目录
    const testDirs = [
      "test",
      "tests",
      "__tests__",
      "spec",
      "specs",
    ];

    // 常见测试文件模式
    const testPatterns = [
      `*${keyword}*test*.ts`,
      `*${keyword}*spec*.ts`,
      `test*${keyword}*.ts`,
      `*${keyword}*.test.ts`,
      `*${keyword}*.spec.ts`,
    ];

    for (const dir of testDirs) {
      const testDir = `${cwd}/${dir}`;

      try {
        await Deno.stat(testDir);
      } catch {
        continue; // 目录不存在
      }

      // 搜索测试文件
      for (const pattern of testPatterns) {
        const files = await this.globFiles(testDir, pattern);
        for (const file of files) {
          tests.push({
            id: `existing-${file}`,
            requirementId: "",
            type: "existing",
            path: file,
            status: "pending",
          });
        }
      }
    }

    return tests;
  }

  /**
   * 简单的 glob 实现
   */
  private async globFiles(dir: string, pattern: string): Promise<string[]> {
    const results: string[] = [];
    const regex = this.patternToRegex(pattern);

    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && regex.test(entry.name)) {
          results.push(`${dir}/${entry.name}`);
        } else if (entry.isDirectory) {
          const subResults = await this.globFiles(`${dir}/${entry.name}`, pattern);
          results.push(...subResults);
        }
      }
    } catch {
      // 忽略读取错误
    }

    return results;
  }

  /**
   * 将 glob 模式转为正则
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i");
  }

  /**
   * 检查测试文件是否包含特定关键词
   */
  async checkTestContent(testPath: string, keywords: string[]): Promise<boolean> {
    try {
      const content = await Deno.readTextFile(testPath);
      const contentLower = content.toLowerCase();

      return keywords.some((k) => contentLower.includes(k.toLowerCase()));
    } catch {
      return false;
    }
  }
}

// 单例导出
export const testFinder = new TestFinder();
```

### 3. src/services/pm/test-generator.ts
```typescript
import type { TestCase, Requirement } from "../../types/pm.ts";

/**
 * 测试模板类型
 */
type TestFramework = "deno" | "jest" | "vitest" | "mocha";

/**
 * 测试生成器
 */
export class TestGenerator {
  /**
   * 为需求生成测试模板
   */
  generateTestTemplate(
    requirement: Requirement,
    framework: TestFramework = "deno"
  ): TestCase {
    const template = this.getTemplate(framework, requirement);

    return {
      id: `generated-${requirement.id}`,
      requirementId: requirement.id,
      type: "generated",
      template,
      status: "pending",
    };
  }

  /**
   * 获取测试模板
   */
  private getTemplate(framework: TestFramework, requirement: Requirement): string {
    const { clarified, acceptance } = requirement;

    switch (framework) {
      case "deno":
        return this.denoTemplate(clarified, acceptance);
      case "jest":
      case "vitest":
        return this.jestTemplate(clarified, acceptance);
      case "mocha":
        return this.mochaTemplate(clarified, acceptance);
      default:
        return this.denoTemplate(clarified, acceptance);
    }
  }

  /**
   * Deno 测试模板
   */
  private denoTemplate(description: string, acceptance: string[]): string {
    const tests = acceptance.map((criteria, i) => `
  await t.step("${criteria}", async () => {
    // TODO: Implement test for: ${criteria}
    // throw new Error("Not implemented");
  });`).join("\n");

    return `import { assertEquals, assertExists } from "https://deno.land/std/assert/mod.ts";

/**
 * Test: ${description}
 * Generated by PMSA
 */
Deno.test("${description}", async (t) => {
${tests}
});
`;
  }

  /**
   * Jest/Vitest 测试模板
   */
  private jestTemplate(description: string, acceptance: string[]): string {
    const tests = acceptance.map((criteria) => `
  it("${criteria}", async () => {
    // TODO: Implement test for: ${criteria}
    // expect(true).toBe(false);
  });`).join("\n");

    return `/**
 * Test: ${description}
 * Generated by PMSA
 */
describe("${description}", () => {
${tests}
});
`;
  }

  /**
   * Mocha 测试模板
   */
  private mochaTemplate(description: string, acceptance: string[]): string {
    const tests = acceptance.map((criteria) => `
  it("${criteria}", async function() {
    // TODO: Implement test for: ${criteria}
    // throw new Error("Not implemented");
  });`).join("\n");

    return `const { expect } = require("chai");

/**
 * Test: ${description}
 * Generated by PMSA
 */
describe("${description}", function() {
${tests}
});
`;
  }

  /**
   * 检测项目使用的测试框架
   */
  async detectFramework(cwd: string = Deno.cwd()): Promise<TestFramework> {
    try {
      // 检查 deno.json
      const denoConfig = await Deno.readTextFile(`${cwd}/deno.json`);
      if (denoConfig.includes('"test"')) {
        return "deno";
      }
    } catch {
      // 不是 Deno 项目
    }

    try {
      // 检查 package.json
      const pkgJson = await Deno.readTextFile(`${cwd}/package.json`);
      const pkg = JSON.parse(pkgJson);

      if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) {
        return "vitest";
      }
      if (pkg.devDependencies?.jest || pkg.dependencies?.jest) {
        return "jest";
      }
      if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) {
        return "mocha";
      }
    } catch {
      // 没有 package.json
    }

    // 默认使用 Deno
    return "deno";
  }
}

// 单例导出
export const testGenerator = new TestGenerator();
```

### 4. src/services/pm/budget-tracker.ts
```typescript
import type { PMBudget } from "../../types/pm.ts";

/**
 * 预算事件类型
 */
export type BudgetEvent = "warning" | "exceeded";

/**
 * 预算监听器
 */
export type BudgetListener = (event: BudgetEvent, budget: PMBudget) => void;

/**
 * 预算追踪器
 */
export class BudgetTracker {
  private budget: PMBudget;
  private listeners: BudgetListener[] = [];
  private warningThreshold = 0.8; // 80% 时预警
  private startTime: number;

  constructor(limits: {
    tokenLimit: number;
    timeLimit: number;  // ms
    attemptsLimit: number;
  }) {
    this.budget = {
      tokenLimit: limits.tokenLimit,
      tokenUsed: 0,
      timeLimit: limits.timeLimit,
      timeUsed: 0,
      attemptsLimit: limits.attemptsLimit,
      attemptsUsed: 0,
    };
    this.startTime = Date.now();
  }

  /**
   * 添加 token 使用
   */
  addTokens(tokens: number): void {
    this.budget.tokenUsed += tokens;
    this.checkBudget();
  }

  /**
   * 更新时间使用
   */
  updateTime(): void {
    this.budget.timeUsed = Date.now() - this.startTime;
    this.checkBudget();
  }

  /**
   * 添加一次尝试
   */
  addAttempt(): void {
    this.budget.attemptsUsed++;
    this.checkBudget();
  }

  /**
   * 检查是否在预算内
   */
  isWithinBudget(): boolean {
    this.updateTime();
    return (
      this.budget.tokenUsed < this.budget.tokenLimit &&
      this.budget.timeUsed < this.budget.timeLimit &&
      this.budget.attemptsUsed < this.budget.attemptsLimit
    );
  }

  /**
   * 获取当前状态
   */
  getStatus(): PMBudget & {
    tokenPercent: number;
    timePercent: number;
    attemptsPercent: number;
  } {
    this.updateTime();
    return {
      ...this.budget,
      tokenPercent: Math.round((this.budget.tokenUsed / this.budget.tokenLimit) * 100),
      timePercent: Math.round((this.budget.timeUsed / this.budget.timeLimit) * 100),
      attemptsPercent: Math.round((this.budget.attemptsUsed / this.budget.attemptsLimit) * 100),
    };
  }

  /**
   * 检查预算并触发事件
   */
  private checkBudget(): void {
    const tokenRatio = this.budget.tokenUsed / this.budget.tokenLimit;
    const timeRatio = this.budget.timeUsed / this.budget.timeLimit;
    const attemptsRatio = this.budget.attemptsUsed / this.budget.attemptsLimit;

    // 检查是否超出
    if (tokenRatio >= 1 || timeRatio >= 1 || attemptsRatio >= 1) {
      this.emit("exceeded", this.budget);
      return;
    }

    // 检查是否接近限制
    if (
      tokenRatio >= this.warningThreshold ||
      timeRatio >= this.warningThreshold ||
      attemptsRatio >= this.warningThreshold
    ) {
      this.emit("warning", this.budget);
    }
  }

  /**
   * 添加监听器
   */
  onBudgetEvent(listener: BudgetListener): void {
    this.listeners.push(listener);
  }

  /**
   * 移除监听器
   */
  offBudgetEvent(listener: BudgetListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /**
   * 触发事件
   */
  private emit(event: BudgetEvent, budget: PMBudget): void {
    for (const listener of this.listeners) {
      listener(event, budget);
    }
  }

  /**
   * 重置预算
   */
  reset(): void {
    this.budget.tokenUsed = 0;
    this.budget.timeUsed = 0;
    this.budget.attemptsUsed = 0;
    this.startTime = Date.now();
  }

  /**
   * 生成预算报告
   */
  getReport(): string {
    const status = this.getStatus();
    return `## 预算使用报告

| 类型 | 已用 | 限制 | 百分比 |
|------|------|------|--------|
| Token | ${status.tokenUsed} | ${status.tokenLimit} | ${status.tokenPercent}% |
| 时间 | ${Math.round(status.timeUsed / 1000)}s | ${Math.round(status.timeLimit / 1000)}s | ${status.timePercent}% |
| 尝试 | ${status.attemptsUsed} | ${status.attemptsLimit} | ${status.attemptsPercent}% |
`;
  }
}
```

### 5. src/services/pm/verification.ts
```typescript
import type { TestCase, Requirement, AlternativePlan } from "../../types/pm.ts";
import { BudgetTracker } from "./budget-tracker.ts";

/**
 * 验证结果
 */
export interface VerificationResult {
  passed: boolean;
  testResults: {
    test: TestCase;
    passed: boolean;
    error?: string;
  }[];
  summary: string;
}

/**
 * 验收循环
 */
export class VerificationLoop {
  private budgetTracker: BudgetTracker;
  private alternatives: AlternativePlan[] = [];
  private currentAlternativeIndex = 0;

  constructor(budgetTracker: BudgetTracker) {
    this.budgetTracker = budgetTracker;
  }

  /**
   * 设置替代方案
   */
  setAlternatives(alternatives: AlternativePlan[]): void {
    // 按置信度排序
    this.alternatives = alternatives.sort((a, b) => b.confidence - a.confidence);
    this.currentAlternativeIndex = 0;
  }

  /**
   * 获取当前方案
   */
  getCurrentPlan(): AlternativePlan | undefined {
    return this.alternatives[this.currentAlternativeIndex];
  }

  /**
   * 切换到下一个方案
   */
  switchToNextPlan(): AlternativePlan | undefined {
    const current = this.alternatives[this.currentAlternativeIndex];
    if (current) {
      current.result = "failed";
      current.triedAt = Date.now();
    }

    this.currentAlternativeIndex++;
    this.budgetTracker.addAttempt();

    return this.alternatives[this.currentAlternativeIndex];
  }

  /**
   * 运行测试
   */
  async runTests(tests: TestCase[]): Promise<VerificationResult> {
    const results: VerificationResult["testResults"] = [];
    let allPassed = true;

    for (const test of tests) {
      try {
        if (test.type === "existing" && test.path) {
          // 运行现有测试
          const passed = await this.runExistingTest(test.path);
          results.push({ test, passed });
          if (!passed) allPassed = false;
        } else if (test.type === "generated" && test.template) {
          // 生成的测试需要先写入文件
          results.push({
            test,
            passed: false,
            error: "Generated test needs to be saved and implemented first",
          });
          allPassed = false;
        }

        test.status = results[results.length - 1].passed ? "passed" : "failed";
        test.lastRun = Date.now();
      } catch (error) {
        results.push({
          test,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        });
        allPassed = false;
      }
    }

    const passedCount = results.filter((r) => r.passed).length;
    const summary = `测试结果: ${passedCount}/${results.length} 通过`;

    return { passed: allPassed, testResults: results, summary };
  }

  /**
   * 运行现有测试文件
   */
  private async runExistingTest(testPath: string): Promise<boolean> {
    try {
      const cmd = new Deno.Command("deno", {
        args: ["test", "--allow-all", testPath],
        stdout: "piped",
        stderr: "piped",
      });

      const { success } = await cmd.output();
      return success;
    } catch {
      return false;
    }
  }

  /**
   * 验收循环主逻辑
   */
  async *verifyWithRetry(
    tests: TestCase[],
    onPlanSwitch: (plan: AlternativePlan) => Promise<void>
  ): AsyncGenerator<{
    type: "attempt" | "switch" | "success" | "budget_exceeded";
    data: unknown;
  }> {
    while (this.budgetTracker.isWithinBudget()) {
      const currentPlan = this.getCurrentPlan();

      yield {
        type: "attempt",
        data: {
          plan: currentPlan,
          attempt: this.budgetTracker.getStatus().attemptsUsed + 1,
        },
      };

      const result = await this.runTests(tests);

      if (result.passed) {
        if (currentPlan) {
          currentPlan.result = "success";
        }
        yield { type: "success", data: result };
        return;
      }

      // 切换到下一个方案
      const nextPlan = this.switchToNextPlan();

      if (!nextPlan) {
        // 没有更多方案
        yield {
          type: "budget_exceeded",
          data: {
            message: "所有替代方案已尝试完毕",
            budget: this.budgetTracker.getStatus(),
          },
        };
        return;
      }

      yield { type: "switch", data: nextPlan };

      // 通知外部切换方案
      await onPlanSwitch(nextPlan);
    }

    yield {
      type: "budget_exceeded",
      data: {
        message: "预算已用尽",
        budget: this.budgetTracker.getStatus(),
      },
    };
  }

  /**
   * 获取替代方案状态
   */
  getAlternativesStatus(): {
    total: number;
    tried: number;
    remaining: number;
    current?: AlternativePlan;
  } {
    return {
      total: this.alternatives.length,
      tried: this.currentAlternativeIndex,
      remaining: this.alternatives.length - this.currentAlternativeIndex - 1,
      current: this.getCurrentPlan(),
    };
  }
}
```

### 6. src/services/pm/mod.ts
```typescript
export { requirementsManager, RequirementsManager } from "./requirements.ts";
export { testFinder, TestFinder } from "./test-finder.ts";
export { testGenerator, TestGenerator } from "./test-generator.ts";
export { BudgetTracker, type BudgetEvent, type BudgetListener } from "./budget-tracker.ts";
export { VerificationLoop, type VerificationResult } from "./verification.ts";
```

## 终点状态（验收标准）

### 必须满足
- [ ] 能创建和管理需求
- [ ] 能生成澄清问题和提取验收标准
- [ ] 能查找现有测试文件
- [ ] 能生成测试模板（Deno/Jest/Vitest/Mocha）
- [ ] 预算追踪器能正确追踪 token/time/attempts
- [ ] 验收循环能自动重试和切换方案

### 测试场景
```typescript
// 1. 需求管理
const req = requirementsManager.create("实现一个快速的缓存功能");
const questions = requirementsManager.generateClarifyingQuestions(req);
assert(questions.length > 0);
assert(questions.some(q => q.includes("快")));  // 检测到模糊词

// 2. 测试查找
const tests = await testFinder.findTests("cache", Deno.cwd());
console.log(`找到 ${tests.length} 个相关测试`);

// 3. 测试生成
const framework = await testGenerator.detectFramework();
const testCase = testGenerator.generateTestTemplate(req, framework);
assert(testCase.template.includes("Test:"));

// 4. 预算追踪
const tracker = new BudgetTracker({
  tokenLimit: 10000,
  timeLimit: 300000,  // 5 分钟
  attemptsLimit: 3,
});

tracker.onBudgetEvent((event, budget) => {
  console.log(`Budget ${event}:`, budget);
});

tracker.addTokens(5000);
assert(tracker.isWithinBudget());
assert(tracker.getStatus().tokenPercent === 50);

// 5. 验收循环
const loop = new VerificationLoop(tracker);
loop.setAlternatives([
  { id: "1", description: "方案A", confidence: 0.8 },
  { id: "2", description: "方案B", confidence: 0.6 },
]);

for await (const event of loop.verifyWithRetry([], async (plan) => {
  console.log(`切换到方案: ${plan.description}`);
})) {
  console.log(event);
}
```

### 交付物
1. `src/services/pm/requirements.ts` - 需求管理
2. `src/services/pm/test-finder.ts` - 测试查找
3. `src/services/pm/test-generator.ts` - 测试生成
4. `src/services/pm/budget-tracker.ts` - 预算追踪
5. `src/services/pm/verification.ts` - 验收循环
6. `src/services/pm/mod.ts` - 统一导出

## 预估时间
3 天
