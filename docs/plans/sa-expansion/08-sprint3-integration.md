# Sprint 3: 集成

## 整体背景
> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

Sprint 3 是最后的集成阶段，将所有新模块集成到现有系统中。

## 依赖关系
```
Sprint 2 完成后才能开始 Sprint 3

G, H, I, J (tools/) ──┬──▶ M (agent-loader.ts)
                      │
                      └──▶ N (tools/mod.ts)

D (logger services) ──▶ L (core/ 修改)
H (tools/logger)    ──┘
```

## 需要修改的现有文件

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/core/query.ts` | 修改 | 注入 Logger hooks |
| `src/core/tool-executor.ts` | 修改 | 注入 Logger hooks |
| `src/tools/task.ts` | 修改 | 注入 SA 调用 hooks |
| `src/utils/agent-loader.ts` | 修改 | 添加新 SA 配置 |
| `src/tools/mod.ts` | 修改 | 注册新工具 |
| `src/services/mod.ts` | 新建 | 服务初始化入口 |

---

## L: core/ 修改（注入 Logger hooks）

### 1. src/core/query.ts 修改

```typescript
// 在文件顶部添加导入
import { loggerService } from "../services/logger/mod.ts";

// 在 query 函数开始处获取 hooks
export async function* query(
  messages: Message[],
  systemPrompt: string[],
  llmClient: LLMClient,
  context: QueryContext,
): AsyncGenerator<Message> {
  // === 新增：获取 logger hooks ===
  const hooks = loggerService.getHooks();

  // 检查 abort
  if (context.abortController.signal.aborted) return;

  // === 新增：记录查询开始 ===
  hooks.onQueryStart(messages);

  // === 新增：记录 LLM 请求 ===
  hooks.onLLMRequest(apiMessages, fullSystemPrompt);

  const startTime = Date.now();

  // 调用 LLM
  const response = await llmClient.complete(
    normalizeMessagesForAPI(messages),
    [...systemPrompt, getPlanModeSystemPrompt(), ...getReminderContents()],
    context.tools,
    context.abortController.signal
  );

  const durationMs = Date.now() - startTime;

  // === 新增：记录 LLM 响应 ===
  hooks.onLLMResponse(response, durationMs);

  // ... 其余代码保持不变 ...

  // === 新增：在函数结束前记录 ===
  // 如果没有工具调用（最终响应）
  if (toolUseBlocks.length === 0) {
    hooks.onQueryEnd(assistantMessage);
    yield assistantMessage;
    return;
  }

  // ... 递归调用 ...
}
```

### 2. src/core/tool-executor.ts 修改

```typescript
// 在文件顶部添加导入
import { loggerService } from "../services/logger/mod.ts";

// 在 executeTool 方法中添加 hooks
private async executeTool(entry: QueueEntry): Promise<void> {
  const hooks = loggerService.getHooks();

  entry.status = "executing";
  const startTime = Date.now();
  const { block } = entry;

  if (block.type !== "tool_use") {
    entry.status = "completed";
    return;
  }

  const tool = this.tools.find((t) => t.name === block.name);

  // === 新增：记录工具开始 ===
  hooks.onToolStart(block.name, block.input);

  // ... 验证逻辑保持不变 ...

  // Execute tool
  try {
    for await (const result of tool.call(parseResult.data, this.context)) {
      if (this.context.abortController.signal.aborted) {
        // === 新增：记录中断 ===
        hooks.onAbort("User interrupted");
        // ... 原有中断处理 ...
        break;
      }

      if (result.type === "progress") {
        // === 新增：记录进度 ===
        hooks.onToolProgress(block.name, result.content);
        continue;
      }

      if (result.type === "streaming_output") {
        // ... 原有流式输出处理 ...
        continue;
      }

      // === 新增：记录工具完成 ===
      const durationMs = Date.now() - startTime;
      hooks.onToolComplete(block.name, result.data, durationMs);

      // ... 原有结果处理 ...
    }
  } catch (error) {
    // === 新增：记录工具错误 ===
    hooks.onToolError(block.name, error instanceof Error ? error : new Error(String(error)));
    // ... 原有错误处理 ...
  }

  entry.status = "completed";
}
```

### 3. src/tools/task.ts 修改

```typescript
// 在文件顶部添加导入
import { loggerService } from "../services/logger/mod.ts";

// 在 runSubagent 调用前后添加 hooks
async *call(input: Input, context: ToolContext) {
  const hooks = loggerService.getHooks();

  // ... 原有验证逻辑 ...

  // === 新增：记录 SA 调用 ===
  hooks.onSAInvoke(subagent_type, prompt);

  try {
    const result = await runSubagent(
      prompt, agentConfig.systemPrompt, filteredTools,
      context.abortController.signal, context.cwd, context.llmConfig
    );

    // === 新增：记录 SA 完成 ===
    hooks.onSAComplete(subagent_type, result);

    yield {
      type: "result",
      data: { taskId, status: "completed", result }
    };
  } catch (error) {
    // === 新增：记录 SA 错误 ===
    hooks.onToolError(`SA:${subagent_type}`, error instanceof Error ? error : new Error(String(error)));
    // ... 原有错误处理 ...
  }
}
```

---

## M: agent-loader.ts 修改

```typescript
// src/utils/agent-loader.ts

import type { AgentConfig } from "../types/agent.ts";

const BUILTIN_AGENTS: Record<string, AgentConfig> = {
  // === 现有 agents 保持不变 ===
  "general-purpose": { ... },
  "Explore": { ... },
  "Plan": { ... },

  // === 新增 SA 配置 ===

  "Remote": {
    name: "Remote",
    whenToUse: "Execute commands and manage files on remote servers via SSH. Use when you need to run commands on a different machine. Handles connection management, daemon communication, and context isolation between local and remote operations.",
    tools: ["RemoteConnect", "RemoteExec", "RemoteFileRead", "RemoteFileWrite", "RemoteDisconnect"],
    disallowedTools: [...SUBAGENT_DISALLOWED_TOOLS],
    model: "inherit",
    systemPrompt: `You are a remote server management specialist. You help execute commands and manage files on remote servers.

Key responsibilities:
- Establish and manage SSH connections to remote servers
- Execute commands on remote hosts with clear context identification
- Transfer files between local and remote systems
- Maintain connection state and handle reconnection

Important guidelines:
- ALWAYS include the hostname in your responses to prevent confusion
- Use absolute paths on remote systems
- Handle network errors gracefully with retry logic
- Clean up connections when done`,
  },

  "Watcher": {
    name: "Watcher",
    whenToUse: "Monitor hardware resources (GPU, CPU, memory, disk, network). Use to track resource usage during long operations, detect bottlenecks, or set up alerts for resource thresholds. Can monitor both local and remote servers.",
    tools: ["WatcherStart", "WatcherStop", "WatcherStatus", "WatcherAlert"],
    disallowedTools: [...SUBAGENT_DISALLOWED_TOOLS],
    model: "haiku",  // 快速响应
    systemPrompt: `You are a hardware monitoring specialist. You help track and report system resource usage.

Key responsibilities:
- Monitor GPU, CPU, memory, disk, and network usage
- Set up alerts for resource thresholds
- Provide clear, actionable reports on resource status
- Identify potential bottlenecks or issues

Important guidelines:
- Report metrics clearly with units
- Highlight any concerning values
- Suggest actions when resources are constrained`,
  },

  "PM": {
    name: "PM",
    whenToUse: "Clarify requirements before implementation. Use when the task is complex or ambiguous. PM will ask clarifying questions, define acceptance criteria, create a test plan, and verify completion. Also handles retry logic when things fail.",
    tools: ["PMClarify", "PMTestPlan", "PMVerify", "PMStatus"],
    disallowedTools: [...SUBAGENT_DISALLOWED_TOOLS],
    model: "inherit",
    systemPrompt: `You are a product manager ensuring clear requirements and successful delivery.

Key responsibilities:
- Clarify ambiguous requirements through targeted questions
- Define clear acceptance criteria
- Create or find relevant test plans
- Manage verification loops with automatic retries
- Track budget (time/tokens) and switch approaches when needed

Important guidelines:
- Ask specific, actionable questions
- Limit questions to 5 maximum per clarification round
- Generate alternative approaches upfront
- Track and report budget usage
- Don't give up until budget is exhausted`,
  },
};

// 其余代码保持不变
```

---

## N: tools/mod.ts 修改

```typescript
// src/tools/mod.ts

// === 新增导入 ===
import { RemoteConnectTool, RemoteExecTool, RemoteFileReadTool, RemoteFileWriteTool, RemoteDisconnectTool } from "./remote/mod.ts";
import { LoggerConfigTool, LoggerQueryTool, LoggerExportTool } from "./logger/mod.ts";
import { WatcherStartTool, WatcherStopTool, WatcherStatusTool, WatcherAlertTool } from "./watcher/mod.ts";
import { PMClarifyTool, PMTestPlanTool, PMVerifyTool, PMStatusTool } from "./pm/mod.ts";

export function getAllTools(): Tool[] {
  return [
    // === 现有工具 ===
    BashTool,
    FileReadTool,
    FileWriteTool,
    FileEditTool,
    GlobTool,
    GrepTool,
    LspTool,
    WebFetchTool,
    WebSearchTool,
    TodoWriteTool,
    EnterPlanModeTool,
    ExitPlanModeTool,
    TaskTool,
    TaskOutputTool,
    CondaTool,
    PipTool,
    UvTool,
    PixiTool,
    DatasetDownloadTool,

    // === 新增工具 ===
    // Remote SA tools
    RemoteConnectTool,
    RemoteExecTool,
    RemoteFileReadTool,
    RemoteFileWriteTool,
    RemoteDisconnectTool,

    // Logger SA tools
    LoggerConfigTool,
    LoggerQueryTool,
    LoggerExportTool,

    // Watcher SA tools
    WatcherStartTool,
    WatcherStopTool,
    WatcherStatusTool,
    WatcherAlertTool,

    // PM SA tools
    PMClarifyTool,
    PMTestPlanTool,
    PMVerifyTool,
    PMStatusTool,
  ];
}
```

---

## 新建：src/services/mod.ts

```typescript
// src/services/mod.ts

import { systemReminderService } from "./system-reminder.ts";
import { loggerService } from "./logger/logger-service.ts";
import { connectionManager } from "./remote/connection-manager.ts";
import { monitorRegistry } from "./watcher/monitor-registry.ts";

export interface ServicesConfig {
  logLevel?: "summary" | "tool" | "llm" | "full";
  logPersistPath?: string;
}

/**
 * 初始化所有服务
 */
export function initializeServices(config: ServicesConfig = {}): void {
  // 1. 初始化 Logger（需要最先初始化，其他服务依赖它）
  loggerService.initialize({
    defaultLevel: config.logLevel || "tool",
    persistPath: config.logPersistPath,
  });

  // 2. 初始化监控器注册表
  monitorRegistry.registerBuiltinMonitors();

  // 3. 重置系统提醒服务
  systemReminderService.resetSession();

  console.log("[Services] All services initialized");
}

/**
 * 清理所有服务
 */
export async function cleanupServices(): Promise<void> {
  // 1. 断开所有远程连接
  await connectionManager.disconnectAll();

  // 2. 停止所有监控
  monitorRegistry.stopAll();

  // 3. 刷新日志
  await loggerService.shutdown();

  console.log("[Services] All services cleaned up");
}

// 导出各服务单例
export { loggerService } from "./logger/logger-service.ts";
export { connectionManager } from "./remote/connection-manager.ts";
export { monitorRegistry } from "./watcher/monitor-registry.ts";
export { systemReminderService } from "./system-reminder.ts";
```

---

## 在 main 入口调用服务初始化

```typescript
// src/mod.ts 或 main 入口文件

import { initializeServices, cleanupServices } from "./services/mod.ts";

// 在程序启动时初始化
initializeServices({
  logLevel: "tool",
});

// 在程序退出时清理
globalThis.addEventListener("unload", () => {
  cleanupServices();
});

// 或者使用 Deno 的信号处理
Deno.addSignalListener("SIGINT", async () => {
  await cleanupServices();
  Deno.exit(0);
});
```

---

## 终点状态（验收标准）

### L: core/ 修改
- [ ] Logger hooks 正确注入到 query.ts
- [ ] Logger hooks 正确注入到 tool-executor.ts
- [ ] Logger hooks 正确注入到 task.ts
- [ ] 所有操作都被记录到日志

### M: agent-loader.ts
- [ ] Remote SA 配置正确
- [ ] Watcher SA 配置正确
- [ ] PM SA 配置正确
- [ ] `getAgentByType()` 能返回新 SA

### N: tools/mod.ts
- [ ] 所有新工具都被注册
- [ ] `getAllTools()` 返回完整列表
- [ ] 工具可以通过 Task 调用

### 服务初始化
- [ ] `initializeServices()` 正确初始化所有服务
- [ ] `cleanupServices()` 正确清理资源
- [ ] 程序退出时连接被正确关闭

---

## 验收测试场景

### 1. Logger 集成测试
```bash
deno task run
> LoggerConfig level=tool
> 执行一些操作（读文件、运行命令等）
> LoggerQuery format=timeline
# 期望：能看到操作时间线
```

### 2. Remote SA 测试
```bash
deno task run
> 使用 Remote SA 连接到 localhost
> 在远程执行 whoami
> 断开连接
# 期望：能看到 [localhost] 前缀的输出
```

### 3. Watcher SA 测试
```bash
deno task run
> 使用 Watcher SA 监控 CPU 和内存
> 获取当前状态
# 期望：能看到 CPU 使用率和内存使用量
```

### 4. PM SA 测试
```bash
deno task run
> 使用 PM SA 澄清需求："实现一个快速的缓存功能"
# 期望：生成澄清问题，包含对"快速"的追问
```

---

## 预估时间

| 任务 | 时间 | 说明 |
|------|------|------|
| L: core/ 修改 | 1 天 | 修改 3 个文件，添加 hooks |
| M: agent-loader.ts | 0.5 天 | 添加 3 个 SA 配置 |
| N: tools/mod.ts | 0.5 天 | 注册所有新工具 |
| 服务初始化 | 0.5 天 | 创建 services/mod.ts |
| 集成测试 | 0.5 天 | 验证所有功能 |

**总计**: 约 3 天

---

## 风险和注意事项

1. **Hook 性能影响**: Logger hooks 在每次操作时都会触发，需要确保异步执行不阻塞主流程
2. **循环依赖**: 注意 services/ 和 core/ 之间的导入顺序
3. **向后兼容**: 确保修改不影响现有功能
4. **测试覆盖**: 新增代码需要有对应的测试
