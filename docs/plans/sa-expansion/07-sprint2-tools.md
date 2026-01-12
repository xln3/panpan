# Sprint 2: 工具层

## 整体背景

> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

Sprint 2 在 Sprint 1 的核心服务层基础上，实现用户可调用的工具层。

## 依赖关系

```
Sprint 1 完成后才能开始 Sprint 2

A (types) ──┬──▶ G (tools/remote)
            │
C (remote)  ┘

A (types) ──┬──▶ H (tools/logger)
            │
D (logger)  ┘

A (types) ──┬──▶ I (tools/watcher)
            │
E (watcher) ┘

A (types) ──┬──▶ J (tools/pm)
            │
F (pm)      ┘

B (diagnostics) ──▶ K (现有工具增强)
```

## 工具层文件结构

```
src/tools/
├── mod.ts                  # 修改：注册新工具
├── remote/
│   ├── mod.ts
│   ├── remote-connect.ts
│   ├── remote-exec.ts
│   ├── remote-file.ts
│   └── remote-disconnect.ts
├── logger/
│   ├── mod.ts
│   ├── logger-config.ts
│   ├── logger-query.ts
│   └── logger-export.ts
├── watcher/
│   ├── mod.ts
│   ├── watcher-start.ts
│   ├── watcher-stop.ts
│   ├── watcher-status.ts
│   └── watcher-alert.ts
└── pm/
    ├── mod.ts
    ├── pm-clarify.ts
    ├── pm-testplan.ts
    ├── pm-verify.ts
    └── pm-status.ts
```

---

## G: tools/remote (依赖 A + C)

### 1. remote-connect.ts

```typescript
import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import type { RemoteConnection } from "../../types/remote.ts";
import { connectionManager } from "../../services/remote/mod.ts";

const inputSchema = z.object({
  hostname: z.string().describe("远程服务器主机名或 IP"),
  port: z.number().default(22).describe("SSH 端口"),
  username: z.string().describe("SSH 用户名"),
  auth_method: z.enum(["key", "password", "agent"]).default("key"),
  key_path: z.string().optional().describe("SSH 私钥路径"),
  connection_id: z.string().optional().describe("自定义连接 ID"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  connectionId: string;
  status: string;
  daemonPort?: number;
}

export const RemoteConnectTool: Tool<typeof inputSchema, Output> = {
  name: "RemoteConnect",
  description: "连接到远程服务器，建立 SSH 通道并启动 daemon",
  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => false,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    yield {
      type: "progress",
      content: `正在连接 ${input.username}@${input.hostname}...`,
    };

    try {
      const connectionId = await connectionManager.connect({
        id: input.connection_id || `${input.username}@${input.hostname}`,
        hostname: input.hostname,
        port: input.port,
        username: input.username,
        authMethod: input.auth_method,
        keyPath: input.key_path,
      });

      const status = connectionManager.getStatus(connectionId);

      yield {
        type: "result",
        data: {
          connectionId,
          status: status?.status || "unknown",
          daemonPort: status?.daemonPort,
        },
        resultForAssistant:
          `已连接到 ${input.hostname}，连接 ID: ${connectionId}`,
      };
    } catch (error) {
      yield {
        type: "result",
        data: {
          connectionId: "",
          status: "error",
        },
        resultForAssistant: `连接失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  },

  renderResultForAssistant(output: Output): string {
    if (output.status === "ready") {
      return `连接成功，ID: ${output.connectionId}，daemon 端口: ${output.daemonPort}`;
    }
    return `连接状态: ${output.status}`;
  },
};
```

### 2. remote-exec.ts

```typescript
import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import type { RemoteExecOutput } from "../../types/remote.ts";
import { connectionManager } from "../../services/remote/mod.ts";

const inputSchema = z.object({
  connection_id: z.string().describe("连接 ID"),
  command: z.string().describe("要执行的命令"),
  cwd: z.string().optional().describe("工作目录"),
  timeout: z.number().default(60000).describe("超时时间（毫秒）"),
});

type Input = z.infer<typeof inputSchema>;

export const RemoteExecTool: Tool<typeof inputSchema, RemoteExecOutput> = {
  name: "RemoteExec",
  description: "在远程服务器上执行命令",
  inputSchema,

  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<RemoteExecOutput>> {
    yield { type: "progress", content: `执行: ${input.command}` };

    try {
      const result = await connectionManager.execute(input.connection_id, {
        command: input.command,
        cwd: input.cwd,
        timeout: input.timeout,
      });

      yield {
        type: "result",
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      };
    } catch (error) {
      yield {
        type: "result",
        data: {
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: -1,
          durationMs: 0,
          host: "unknown",
        },
      };
    }
  },

  renderResultForAssistant(output: RemoteExecOutput): string {
    const lines = [`[${output.host}] Exit code: ${output.exitCode}`];
    if (output.stdout) {
      lines.push(`stdout:\n${output.stdout.slice(0, 2000)}`);
    }
    if (output.stderr) {
      lines.push(`stderr:\n${output.stderr.slice(0, 500)}`);
    }
    return lines.join("\n");
  },
};
```

### 3. remote-file.ts / remote-disconnect.ts

类似模式，封装 `connectionManager.readFile()`, `writeFile()`, `disconnect()`。

---

## H: tools/logger (依赖 A + D)

### 1. logger-config.ts

```typescript
import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import type { LogLevel } from "../../types/logger.ts";
import { loggerService } from "../../services/logger/mod.ts";

const inputSchema = z.object({
  level: z.enum(["summary", "tool", "llm", "full"]).describe("日志级别"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  previousLevel: LogLevel;
  newLevel: LogLevel;
}

export const LoggerConfigTool: Tool<typeof inputSchema, Output> = {
  name: "LoggerConfig",
  description:
    "配置日志级别。summary=摘要，tool=工具调用，llm=LLM交互，full=全量",
  inputSchema,

  isReadOnly: () => false,
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const previousLevel = loggerService.getLevel();
    loggerService.setLevel(input.level);

    yield {
      type: "result",
      data: { previousLevel, newLevel: input.level },
      resultForAssistant: `日志级别已从 ${previousLevel} 切换为 ${input.level}`,
    };
  },

  renderResultForAssistant(output: Output): string {
    return `日志级别: ${output.previousLevel} → ${output.newLevel}`;
  },
};
```

### 2. logger-query.ts

```typescript
import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { loggerService } from "../../services/logger/mod.ts";

const inputSchema = z.object({
  level: z.enum(["summary", "tool", "llm", "full"]).optional(),
  type: z.string().optional(),
  limit: z.number().default(20),
  failures_only: z.boolean().default(false),
  format: z.enum(["summary", "timeline", "raw"]).default("summary"),
});

type Input = z.infer<typeof inputSchema>;

export const LoggerQueryTool: Tool<typeof inputSchema, string> = {
  name: "LoggerQuery",
  description: "查询操作日志",
  inputSchema,

  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<string>> {
    let result: string;

    switch (input.format) {
      case "summary":
        result = loggerService.getSummary();
        break;
      case "timeline":
        result = loggerService.getTimeline();
        break;
      case "raw":
      default:
        const logs = loggerService.query({
          level: input.level,
          type: input.type,
          limit: input.limit,
          failuresOnly: input.failures_only,
        });
        result = JSON.stringify(logs, null, 2);
    }

    yield { type: "result", data: result };
  },

  renderResultForAssistant(output: string): string {
    return output.slice(0, 3000);
  },
};
```

### 3. logger-export.ts

导出为 JSON/Markdown 文件。

---

## I: tools/watcher (依赖 A + E)

### 1. watcher-start.ts

```typescript
import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { monitorRegistry } from "../../services/watcher/mod.ts";

const inputSchema = z.object({
  monitors: z.array(z.enum(["gpu", "cpu", "memory", "disk", "network"]))
    .describe("要启动的监控类型"),
});

type Input = z.infer<typeof inputSchema>;

export const WatcherStartTool: Tool<typeof inputSchema, { started: string[] }> =
  {
    name: "WatcherStart",
    description: "启动资源监控",
    inputSchema,

    isReadOnly: () => false,
    isConcurrencySafe: () => false,

    async *call(
      input: Input,
      _context: ToolContext,
    ): AsyncGenerator<ToolYield<{ started: string[] }>> {
      monitorRegistry.registerBuiltinMonitors();

      const started: string[] = [];
      const available = await monitorRegistry.getAvailable();

      for (const type of input.monitors) {
        const monitors = available.filter((m) => m.type === type);
        for (const m of monitors) {
          started.push(`${m.type}: ${m.name}`);
        }
      }

      yield {
        type: "result",
        data: { started },
        resultForAssistant: `已启动监控: ${started.join(", ")}`,
      };
    },

    renderResultForAssistant(output: { started: string[] }): string {
      return `监控已启动: ${output.started.join(", ")}`;
    },
  };
```

### 2. watcher-status.ts

采样并返回当前资源状态。

### 3. watcher-alert.ts

配置告警规则。

---

## J: tools/pm (依赖 A + F)

### 1. pm-clarify.ts

```typescript
import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import { requirementsManager } from "../../services/pm/mod.ts";

const inputSchema = z.object({
  requirements: z.string().describe("用户的原始需求"),
  auto_ask: z.boolean().default(true).describe("自动生成澄清问题"),
});

type Input = z.infer<typeof inputSchema>;

interface Output {
  requirementId: string;
  questions: string[];
}

export const PMClarifyTool: Tool<typeof inputSchema, Output> = {
  name: "PMClarify",
  description: "澄清需求，生成问题帮助明确需求",
  inputSchema,

  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async *call(
    input: Input,
    _context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const requirement = requirementsManager.create(input.requirements);
    const questions = input.auto_ask
      ? requirementsManager.generateClarifyingQuestions(requirement)
      : [];

    yield {
      type: "result",
      data: {
        requirementId: requirement.id,
        questions,
      },
      resultForAssistant: questions.length > 0
        ? `需求已记录 (${requirement.id})。需要澄清的问题:\n${
          questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
        }`
        : `需求已记录 (${requirement.id})`,
    };
  },

  renderResultForAssistant(output: Output): string {
    return `需求 ID: ${output.requirementId}\n问题: ${output.questions.length} 个`;
  },
};
```

### 2. pm-testplan.ts

查找或生成测试。

### 3. pm-verify.ts

运行验收测试。

### 4. pm-status.ts

获取预算和进度状态。

---

## K: 现有工具增强 (依赖 B)

### 增强 Pip 工具

```typescript
// 在 src/tools/package-managers/pip.ts 中添加诊断逻辑

import {
  classifyError,
  createRetryContext,
  shouldRetry,
  applyFix,
  updateRetryContext,
  getMirrors,
  getPipMirrorEnv,
} from "../../utils/diagnostics/mod.ts";

// 在 call 方法中包裹执行逻辑
async *call(input: Input, context: ToolContext) {
  const retryContext = createRetryContext();
  const maxAttempts = 3;

  while (retryContext.attempt < maxAttempts) {
    // 执行 pip 命令
    let result;
    for await (const item of executeCommandStreaming(...)) {
      if ("exitCode" in item) result = item;
      yield item;
    }

    // 成功则返回
    if (result.exitCode === 0) {
      yield { type: "result", data: result };
      return;
    }

    // 诊断错误
    const diagnosis = await classifyError(result.stderr, { tool: "pip" });

    // 尝试自动修复
    const { shouldRetry: doRetry, nextFix, delayMs } = shouldRetry(retryContext, diagnosis);

    if (!doRetry || !nextFix) {
      // 无法自动修复，返回带诊断的结果
      yield {
        type: "result",
        data: {
          ...result,
          diagnosis,
        },
        resultForAssistant: diagnosis.requiresUserInput
          ? diagnosis.userQuestion
          : `执行失败: ${result.stderr}`,
      };
      return;
    }

    // 应用修复
    yield { type: "progress", content: `尝试修复: ${nextFix.description}` };
    await applyFix(nextFix);

    // 如果是镜像修复，更新环境变量
    if (nextFix.action.type === "use_mirror") {
      const mirrorEnv = getPipMirrorEnv(nextFix.action.url);
      Object.assign(process.env, mirrorEnv);
    }

    // 更新重试上下文
    retryContext = updateRetryContext(retryContext, nextFix, delayMs);

    // 等待后重试
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
```

---

## 终点状态（验收标准）

### G: tools/remote

- [ ] `RemoteConnect` 能连接远程服务器
- [ ] `RemoteExec` 能执行命令，输出包含主机名
- [ ] `RemoteFile*` 能读写远程文件
- [ ] `RemoteDisconnect` 能正确断开连接

### H: tools/logger

- [ ] `LoggerConfig` 能切换日志级别
- [ ] `LoggerQuery` 能按级别/类型查询日志
- [ ] `LoggerExport` 能导出为 JSON/Markdown

### I: tools/watcher

- [ ] `WatcherStart` 能启动监控
- [ ] `WatcherStatus` 能返回当前资源状态
- [ ] `WatcherAlert` 能配置告警规则

### J: tools/pm

- [ ] `PMClarify` 能生成澄清问题
- [ ] `PMTestPlan` 能查找/生成测试
- [ ] `PMVerify` 能运行验收测试
- [ ] `PMStatus` 能显示预算状态

### K: 现有工具增强

- [ ] Pip 超时时自动尝试镜像
- [ ] Conda/Uv/Pixi 同样增强
- [ ] 错误返回包含诊断信息

---

## 预估时间

| 模块             | 时间   | 可并行          |
| ---------------- | ------ | --------------- |
| G: tools/remote  | 1.5 天 | 是（需 C 完成） |
| H: tools/logger  | 1 天   | 是（需 D 完成） |
| I: tools/watcher | 1 天   | 是（需 E 完成） |
| J: tools/pm      | 1.5 天 | 是（需 F 完成） |
| K: 工具增强      | 2 天   | 是（需 B 完成） |

**并行执行总时间**: 约 2-3 天（取决于 Sprint 1 完成顺序）
