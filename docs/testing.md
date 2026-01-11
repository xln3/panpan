# panpan 测试指南

## 概述

panpan 使用 Deno 原生测试框架，遵循以下原则：

1. **单个测试尽可能小** - 每个测试只验证一个行为
2. **整体覆盖尽可能全** - 覆盖正常路径、边界条件、错误处理
3. **优先纯函数** - 无副作用的函数最容易测试

## 目录结构

```
test/
├── _helpers/                 # 测试辅助工具
│   ├── mod.ts               # 统一导出
│   ├── async-generator.ts   # 异步生成器收集器
│   ├── temp-dir.ts          # 临时目录管理
│   └── mock-context.ts      # ToolContext 工厂
│
├── _mocks/                   # Mock 实现
│   ├── mod.ts               # 统一导出
│   ├── llm-client.ts        # Mock LLMClient
│   └── fetch.ts             # Mock fetch
│
├── core/                     # src/core/ 测试
│   ├── messages_test.ts     # 消息创建和规范化
│   └── tool-executor_test.ts # 工具执行器并发控制
│
├── llm/                      # src/llm/ 测试
│   ├── provider-factory_test.ts  # Provider 检测
│   └── stream-parser_test.ts     # SSE 流解析
│
├── tools/                    # src/tools/ 测试
│   ├── glob_test.ts         # 文件模式匹配
│   ├── grep_test.ts         # 内容搜索
│   └── file-read_test.ts    # 文件读取
│
├── utils/                    # src/utils/ 测试
│   ├── plan-mode_test.ts    # Plan mode 状态管理
│   └── todo-storage_test.ts # Todo 存储验证
│
└── config/                   # src/config/ 测试
    └── config_test.ts       # 配置加载优先级
```

## 运行测试

### 基本命令

```bash
# 运行全部测试
deno task test

# 只运行单元测试（不含工具测试）
deno task test:unit

# 只运行工具测试
deno task test:tools

# 持续监听模式
deno task test:watch

# 生成覆盖率报告
deno task test:coverage
deno coverage coverage/
```

### 运行单个测试文件

```bash
# 运行特定文件
deno test --allow-read --allow-env test/llm/provider-factory_test.ts

# 运行匹配名称的测试
deno test --filter "detectProviderType" test/
```

## 测试辅助工具

### collectGenerator

收集异步生成器的所有结果：

```typescript
import { collectGenerator } from "../_helpers/mod.ts";

const gen = someAsyncGenerator();
const results = await collectGenerator(gen);
assertEquals(results.length, 3);
```

### withTempDir

在临时目录中运行测试，自动清理：

```typescript
import { withTempDir, createTempStructure } from "../_helpers/mod.ts";

Deno.test("file operation test", async () => {
  await withTempDir(async (dir) => {
    await createTempStructure(dir, {
      "src/app.ts": "content",
      "src/lib/utils.ts": "content",
    });
    // 测试代码...
  });
  // dir 自动删除
});
```

### createMockToolContext

创建工具执行上下文：

```typescript
import { createMockToolContext } from "../_helpers/mod.ts";

const context = createMockToolContext({
  cwd: "/custom/path",
  abortController: new AbortController(),
});
```

## 测试模式

### 1. 纯函数测试

```typescript
Deno.test("detectProviderType - returns anthropic for claude-* models", () => {
  assertEquals(detectProviderType("claude-3-opus"), "anthropic");
  assertEquals(detectProviderType("claude-haiku"), "anthropic");
});
```

### 2. 异步生成器测试

```typescript
Deno.test("tool yields results", async () => {
  const results = await collectGenerator(SomeTool.call(input, context));
  assertEquals(results.length, 1);
  assertEquals(results[0].type, "result");
});
```

### 3. 文件系统测试

```typescript
Deno.test("reads file content", async () => {
  await withTempDir(async (dir) => {
    await createTempFile(dir, "test.txt", "Hello");
    const output = await runFileRead({ file_path: join(dir, "test.txt") }, dir);
    assertEquals(output.content.includes("Hello"), true);
  });
});
```

### 4. Abort 处理测试

```typescript
Deno.test("respects abort signal", async () => {
  const controller = new AbortController();
  const context = createMockToolContext({ abortController: controller });

  controller.abort(); // 预先中止

  const results = await collectGenerator(SomeTool.call(input, context));
  assertEquals(results.length, 0);
});
```

### 5. 环境变量测试

```typescript
function withEnv(vars: Record<string, string>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    original[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  }
  try {
    fn();
  } finally {
    for (const [key, val] of Object.entries(original)) {
      val ? Deno.env.set(key, val) : Deno.env.delete(key);
    }
  }
}

Deno.test("config priority", () => {
  withEnv({ PANPAN_API_KEY: "env-key" }, () => {
    const config = loadConfig({ apiKey: "cli-key" });
    assertEquals(config.apiKey, "cli-key"); // CLI 优先
  });
});
```

## 测试覆盖模块

| 模块 | 文件 | 测试数量 | 覆盖内容 |
|------|------|---------|----------|
| config | config_test.ts | 25 | 配置优先级、验证 |
| core/messages | messages_test.ts | 23 | 消息创建、规范化、orphan 清理 |
| core/tool-executor | tool-executor_test.ts | 13 | 并发控制、schema 验证、abort |
| llm/provider-factory | provider-factory_test.ts | 17 | Provider 检测、创建 |
| llm/stream-parser | stream-parser_test.ts | 19 | SSE 解析、tool call 累积 |
| tools/file-read | file-read_test.ts | 22 | 读取、offset/limit、时间戳 |
| tools/glob | glob_test.ts | 18 | 模式匹配、截断、验证 |
| tools/grep | grep_test.ts | 20 | 正则匹配、输出模式、上下文 |
| utils/plan-mode | plan-mode_test.ts | 25 | 状态管理、权限检查 |
| utils/todo-storage | todo-storage_test.ts | 25+ | Todo CRUD、验证、渲染 |

## 添加新测试

1. 在对应目录下创建 `*_test.ts` 文件
2. 导入 `@std/assert` 和需要的辅助工具
3. 每个测试用例使用 `Deno.test()` 包装
4. 测试名称使用 "模块 - 行为描述" 格式

```typescript
import { assertEquals } from "jsr:@std/assert@1";
import { SomeFunction } from "../../src/module/file.ts";

Deno.test("SomeFunction - handles empty input", () => {
  const result = SomeFunction("");
  assertEquals(result, null);
});
```

## 调试测试

```bash
# 显示详细输出
deno test --fail-fast -v test/

# 跳过类型检查（更快）
deno test --no-check test/

# 只运行失败的测试
deno test --filter "FAILED" test/
```
