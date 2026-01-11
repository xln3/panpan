# 模块 D: Logger 服务

## 整体背景
> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

本模块实现 LoggerSA 的核心服务层，采用**观察者模式**通过 hook 注入被动记录所有操作，提供四级日志体系。

## 设计要点
- **观察者模式**: 通过 hook 被动记录，不影响正常执行流程
- **四级日志**: summary > tool > llm > full
- **客观记录**: 不受 agent 主观影响，记录包括失败操作
- **失败分析**: 帮助找到更可能成功的替代路线

## 依赖关系
- **依赖**: 无（可立即开始）
- **类型依赖**: `src/types/logger.ts`
- **被依赖**:
  - Sprint 2 的 tools/logger (H)
  - Sprint 3 的 core/ 修改 (L)

## 文件结构
```
src/services/logger/
├── mod.ts              # 统一导出
├── logger-service.ts   # 主服务，管理日志级别和存储
├── hooks.ts            # Hook 定义和注入辅助
├── log-storage.ts      # 多级日志存储
├── summarizer.ts       # 摘要生成
└── failure-analyzer.ts # 失败分析
```

## 详细设计

### 1. src/services/logger/log-storage.ts
```typescript
import type { LogEntry, LogLevel, SummaryLogEntry, ToolLogEntry, LLMLogEntry } from "../../types/logger.ts";

/**
 * 日志存储配置
 */
export interface LogStorageConfig {
  maxEntries: number;      // 最大条目数
  persistPath?: string;    // 持久化路径（可选）
  autoFlush: boolean;      // 自动刷新到磁盘
  flushInterval: number;   // 刷新间隔（ms）
}

const DEFAULT_CONFIG: LogStorageConfig = {
  maxEntries: 10000,
  autoFlush: false,
  flushInterval: 30000,
};

/**
 * 日志存储
 */
export class LogStorage {
  private entries: LogEntry[] = [];
  private config: LogStorageConfig;
  private flushTimer?: number;

  constructor(config: Partial<LogStorageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoFlush && this.config.persistPath) {
      this.startAutoFlush();
    }
  }

  /**
   * 添加日志条目
   */
  add(entry: LogEntry): void {
    this.entries.push(entry);

    // 超过最大条目数时删除旧条目
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(-this.config.maxEntries);
    }
  }

  /**
   * 查询日志
   */
  query(options: {
    level?: LogLevel;
    type?: string;
    since?: number;
    until?: number;
    limit?: number;
    failuresOnly?: boolean;
  } = {}): LogEntry[] {
    let results = [...this.entries];

    // 按级别过滤
    if (options.level) {
      const levelPriority: Record<LogLevel, number> = {
        summary: 0,
        tool: 1,
        llm: 2,
        full: 3,
      };
      const targetPriority = levelPriority[options.level];
      results = results.filter(
        (e) => levelPriority[e.level] <= targetPriority
      );
    }

    // 按类型过滤
    if (options.type) {
      results = results.filter((e) => e.type === options.type);
    }

    // 按时间过滤
    if (options.since) {
      results = results.filter((e) => e.timestamp >= options.since!);
    }
    if (options.until) {
      results = results.filter((e) => e.timestamp <= options.until!);
    }

    // 仅失败
    if (options.failuresOnly) {
      results = results.filter((e) => !e.success);
    }

    // 限制数量
    if (options.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  /**
   * 获取摘要视图
   */
  getSummaries(): SummaryLogEntry[] {
    return this.entries
      .filter((e) => e.level === "summary")
      .map((e) => ({
        timestamp: e.timestamp,
        action: e.type,
        success: e.success,
        duration: e.duration || 0,
      }));
  }

  /**
   * 获取工具日志视图
   */
  getToolLogs(): ToolLogEntry[] {
    return this.entries.filter(
      (e) => e.type === "tool_call" || e.type === "tool_result"
    ) as ToolLogEntry[];
  }

  /**
   * 获取 LLM 日志视图
   */
  getLLMLogs(): LLMLogEntry[] {
    return this.entries.filter(
      (e) => e.type === "llm_request" || e.type === "llm_response"
    ) as LLMLogEntry[];
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * 获取所有条目
   */
  getAll(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * 持久化到文件
   */
  async flush(): Promise<void> {
    if (!this.config.persistPath) return;

    const data = JSON.stringify(this.entries, null, 2);
    await Deno.writeTextFile(this.config.persistPath, data);
  }

  /**
   * 从文件加载
   */
  async load(): Promise<void> {
    if (!this.config.persistPath) return;

    try {
      const data = await Deno.readTextFile(this.config.persistPath);
      this.entries = JSON.parse(data);
    } catch {
      // 文件不存在，忽略
    }
  }

  /**
   * 启动自动刷新
   */
  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.config.flushInterval);
  }

  /**
   * 停止自动刷新
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  /**
   * 导出为 JSON
   */
  exportJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * 导出为 Markdown
   */
  exportMarkdown(): string {
    const lines: string[] = ["# Operation Log\n"];

    for (const entry of this.entries) {
      const time = new Date(entry.timestamp).toISOString();
      const status = entry.success ? "✓" : "✗";
      lines.push(`## ${status} ${entry.type} (${time})`);
      lines.push(`- Level: ${entry.level}`);
      if (entry.duration) {
        lines.push(`- Duration: ${entry.duration}ms`);
      }
      if (entry.error) {
        lines.push(`- Error: ${entry.error}`);
      }
      lines.push(`\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\``);
      lines.push("");
    }

    return lines.join("\n");
  }
}
```

### 2. src/services/logger/hooks.ts
```typescript
import type { LoggerHooks, LogEntry, LogLevel } from "../../types/logger.ts";
import { LogStorage } from "./log-storage.ts";

/**
 * 创建日志 hooks
 */
export function createLoggerHooks(
  storage: LogStorage,
  currentLevel: () => LogLevel
): LoggerHooks {
  const shouldLog = (level: LogLevel): boolean => {
    const levelPriority: Record<LogLevel, number> = {
      summary: 0,
      tool: 1,
      llm: 2,
      full: 3,
    };
    return levelPriority[level] <= levelPriority[currentLevel()];
  };

  const createEntry = (
    level: LogLevel,
    type: LogEntry["type"],
    data: unknown,
    success = true,
    error?: string
  ): LogEntry => ({
    id: crypto.randomUUID(),
    level,
    timestamp: Date.now(),
    type,
    data,
    success,
    error,
  });

  return {
    onQueryStart(messages: unknown[]): void {
      if (shouldLog("full")) {
        storage.add(createEntry("full", "user_input", { messages }));
      }
    },

    onLLMRequest(messages: unknown[], systemPrompt: string[]): void {
      if (shouldLog("llm")) {
        storage.add(createEntry("llm", "llm_request", {
          messageCount: Array.isArray(messages) ? messages.length : 0,
          systemPromptLength: systemPrompt.join("").length,
        }));
      }
    },

    onLLMResponse(response: unknown, durationMs: number): void {
      if (shouldLog("llm")) {
        const entry = createEntry("llm", "llm_response", {
          response: (response as Record<string, unknown>)?.content ? "..." : response,
          durationMs,
        });
        entry.duration = durationMs;
        storage.add(entry);
      }

      // 摘要级别：记录 LLM 调用
      if (shouldLog("summary")) {
        storage.add(createEntry("summary", "llm_response", {
          action: "LLM call",
          durationMs,
        }));
      }
    },

    onQueryEnd(finalMessage: unknown): void {
      if (shouldLog("full")) {
        storage.add(createEntry("full", "llm_response", { finalMessage }));
      }
    },

    onToolStart(toolName: string, input: unknown): void {
      if (shouldLog("tool")) {
        storage.add(createEntry("tool", "tool_call", {
          toolName,
          input,
          startTime: Date.now(),
        }));
      }
    },

    onToolProgress(toolName: string, progress: string): void {
      if (shouldLog("full")) {
        storage.add(createEntry("full", "tool_call", {
          toolName,
          progress,
        }));
      }
    },

    onToolComplete(toolName: string, result: unknown, durationMs: number): void {
      if (shouldLog("tool")) {
        const entry = createEntry("tool", "tool_result", {
          toolName,
          result: typeof result === "string" && result.length > 500
            ? result.slice(0, 500) + "..."
            : result,
          durationMs,
        });
        entry.duration = durationMs;
        storage.add(entry);
      }

      // 摘要级别
      if (shouldLog("summary")) {
        storage.add(createEntry("summary", "tool_result", {
          action: `Tool: ${toolName}`,
          durationMs,
        }));
      }
    },

    onToolError(toolName: string, error: Error): void {
      // 错误始终记录
      const entry = createEntry("tool", "tool_result", {
        toolName,
        error: error.message,
      }, false, error.message);
      storage.add(entry);

      // 摘要级别也记录错误
      storage.add(createEntry("summary", "error", {
        action: `Tool error: ${toolName}`,
        error: error.message,
      }, false, error.message));
    },

    onSAInvoke(agentType: string, prompt: string): void {
      if (shouldLog("tool")) {
        storage.add(createEntry("tool", "sa_invoke", {
          agentType,
          promptLength: prompt.length,
        }));
      }

      if (shouldLog("summary")) {
        storage.add(createEntry("summary", "sa_invoke", {
          action: `Subagent: ${agentType}`,
        }));
      }
    },

    onSAComplete(agentType: string, result: string): void {
      if (shouldLog("tool")) {
        storage.add(createEntry("tool", "sa_result", {
          agentType,
          resultLength: result.length,
        }));
      }
    },

    onAbort(reason: string): void {
      // 中断始终记录
      storage.add(createEntry("summary", "abort", { reason }, false, reason));
    },
  };
}
```

### 3. src/services/logger/summarizer.ts
```typescript
import type { LogEntry, SummaryLogEntry } from "../../types/logger.ts";

/**
 * 生成操作摘要
 */
export function generateSummary(entries: LogEntry[]): string {
  const stats = {
    totalOperations: 0,
    successCount: 0,
    failureCount: 0,
    totalDurationMs: 0,
    toolCalls: new Map<string, number>(),
    llmCalls: 0,
    saCalls: 0,
  };

  for (const entry of entries) {
    stats.totalOperations++;

    if (entry.success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }

    if (entry.duration) {
      stats.totalDurationMs += entry.duration;
    }

    if (entry.type === "tool_call" || entry.type === "tool_result") {
      const toolName = (entry.data as Record<string, unknown>)?.toolName as string;
      if (toolName) {
        stats.toolCalls.set(toolName, (stats.toolCalls.get(toolName) || 0) + 1);
      }
    }

    if (entry.type === "llm_request" || entry.type === "llm_response") {
      stats.llmCalls++;
    }

    if (entry.type === "sa_invoke") {
      stats.saCalls++;
    }
  }

  const lines: string[] = [
    "## 操作摘要",
    "",
    `- 总操作数: ${stats.totalOperations}`,
    `- 成功: ${stats.successCount}`,
    `- 失败: ${stats.failureCount}`,
    `- 总耗时: ${(stats.totalDurationMs / 1000).toFixed(2)}s`,
    "",
    "### 工具调用统计",
  ];

  for (const [tool, count] of stats.toolCalls) {
    lines.push(`- ${tool}: ${count} 次`);
  }

  lines.push("");
  lines.push(`### LLM 调用: ${stats.llmCalls / 2} 轮`);
  lines.push(`### Subagent 调用: ${stats.saCalls} 次`);

  return lines.join("\n");
}

/**
 * 生成时间线视图
 */
export function generateTimeline(entries: LogEntry[]): string {
  const lines: string[] = ["## 操作时间线", ""];

  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);

  for (const entry of sorted) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const status = entry.success ? "✓" : "✗";
    const duration = entry.duration ? ` (${entry.duration}ms)` : "";

    let description: string;
    switch (entry.type) {
      case "tool_call":
        description = `Tool: ${(entry.data as Record<string, unknown>)?.toolName}`;
        break;
      case "llm_request":
        description = "LLM 请求";
        break;
      case "llm_response":
        description = "LLM 响应";
        break;
      case "sa_invoke":
        description = `Subagent: ${(entry.data as Record<string, unknown>)?.agentType}`;
        break;
      default:
        description = entry.type;
    }

    lines.push(`${time} ${status} ${description}${duration}`);

    if (!entry.success && entry.error) {
      lines.push(`       ↳ Error: ${entry.error}`);
    }
  }

  return lines.join("\n");
}
```

### 4. src/services/logger/failure-analyzer.ts
```typescript
import type { LogEntry, FailurePoint } from "../../types/logger.ts";

/**
 * 分析失败点
 */
export function analyzeFailures(entries: LogEntry[]): FailurePoint[] {
  const failures: FailurePoint[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.success) continue;

    // 获取前面的步骤作为上下文
    const previousSteps: string[] = [];
    for (let j = Math.max(0, i - 5); j < i; j++) {
      const prev = entries[j];
      previousSteps.push(`${prev.type}: ${JSON.stringify(prev.data).slice(0, 100)}`);
    }

    // 收集当时的工具状态
    const toolState: Record<string, unknown> = {};
    for (let j = 0; j <= i; j++) {
      const prev = entries[j];
      if (prev.type === "tool_result" && prev.success) {
        const toolName = (prev.data as Record<string, unknown>)?.toolName as string;
        if (toolName) {
          toolState[toolName] = "executed";
        }
      }
    }

    failures.push({
      entryId: entry.id,
      type: entry.type,
      error: entry.error || "Unknown error",
      context: {
        previousSteps,
        toolState,
      },
      suggestedFixes: suggestFixes(entry),
    });
  }

  return failures;
}

/**
 * 根据失败类型建议修复
 */
function suggestFixes(entry: LogEntry): string[] {
  const fixes: string[] = [];
  const error = entry.error?.toLowerCase() || "";
  const data = entry.data as Record<string, unknown>;

  // 网络相关错误
  if (
    error.includes("timeout") ||
    error.includes("network") ||
    error.includes("connection")
  ) {
    fixes.push("尝试使用代理或 VPN");
    fixes.push("检查网络连接");
    fixes.push("使用镜像源");
  }

  // 权限错误
  if (error.includes("permission") || error.includes("access denied")) {
    fixes.push("检查文件/目录权限");
    fixes.push("尝试使用 sudo");
  }

  // 依赖缺失
  if (error.includes("not found") || error.includes("no such file")) {
    fixes.push("检查路径是否正确");
    fixes.push("确认依赖已安装");
  }

  // 工具特定建议
  if (data?.toolName === "Pip" || data?.toolName === "Conda") {
    fixes.push("尝试使用清华镜像源");
    fixes.push("检查 Python 环境是否正确激活");
  }

  if (fixes.length === 0) {
    fixes.push("检查错误信息，查找相关文档");
  }

  return fixes;
}

/**
 * 找到可能的替代路线
 */
export function findAlternativeRoutes(
  failures: FailurePoint[],
  allEntries: LogEntry[]
): string[] {
  const alternatives: string[] = [];

  // 分析失败模式
  const failureTypes = new Map<string, number>();
  for (const failure of failures) {
    const key = `${failure.type}:${failure.error.split(":")[0]}`;
    failureTypes.set(key, (failureTypes.get(key) || 0) + 1);
  }

  // 根据失败模式建议替代路线
  for (const [type, count] of failureTypes) {
    if (type.includes("network") || type.includes("timeout")) {
      alternatives.push("网络问题频繁，建议先解决网络配置");
    }

    if (type.includes("permission")) {
      alternatives.push("权限问题，考虑在用户目录执行或检查权限设置");
    }

    if (count >= 3) {
      alternatives.push(`"${type}" 失败 ${count} 次，可能需要换一种方法`);
    }
  }

  return [...new Set(alternatives)];
}
```

### 5. src/services/logger/logger-service.ts
```typescript
import type { LogLevel, LoggerHooks, LogEntry, FailurePoint } from "../../types/logger.ts";
import { LogStorage, type LogStorageConfig } from "./log-storage.ts";
import { createLoggerHooks } from "./hooks.ts";
import { generateSummary, generateTimeline } from "./summarizer.ts";
import { analyzeFailures, findAlternativeRoutes } from "./failure-analyzer.ts";

/**
 * Logger 服务配置
 */
export interface LoggerServiceConfig extends Partial<LogStorageConfig> {
  defaultLevel?: LogLevel;
}

/**
 * Logger 主服务
 */
class LoggerService {
  private storage: LogStorage;
  private hooks: LoggerHooks;
  private currentLevel: LogLevel = "tool";
  private initialized = false;

  constructor() {
    this.storage = new LogStorage();
    this.hooks = createLoggerHooks(this.storage, () => this.currentLevel);
  }

  /**
   * 初始化服务
   */
  initialize(config: LoggerServiceConfig = {}): void {
    if (this.initialized) return;

    this.storage = new LogStorage(config);
    this.hooks = createLoggerHooks(this.storage, () => this.currentLevel);

    if (config.defaultLevel) {
      this.currentLevel = config.defaultLevel;
    }

    this.initialized = true;
  }

  /**
   * 获取 hooks（供 core/ 注入使用）
   */
  getHooks(): LoggerHooks {
    return this.hooks;
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * 查询日志
   */
  query(options: {
    level?: LogLevel;
    type?: string;
    since?: number;
    limit?: number;
    failuresOnly?: boolean;
  } = {}): LogEntry[] {
    return this.storage.query(options);
  }

  /**
   * 获取操作摘要
   */
  getSummary(): string {
    return generateSummary(this.storage.getAll());
  }

  /**
   * 获取时间线
   */
  getTimeline(): string {
    return generateTimeline(this.storage.getAll());
  }

  /**
   * 分析失败
   */
  analyzeFailures(): FailurePoint[] {
    return analyzeFailures(this.storage.getAll());
  }

  /**
   * 获取替代路线建议
   */
  getAlternativeRoutes(): string[] {
    const failures = this.analyzeFailures();
    return findAlternativeRoutes(failures, this.storage.getAll());
  }

  /**
   * 导出日志
   */
  export(format: "json" | "markdown"): string {
    if (format === "json") {
      return this.storage.exportJSON();
    }
    return this.storage.exportMarkdown();
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * 刷新到磁盘
   */
  async flush(): Promise<void> {
    await this.storage.flush();
  }

  /**
   * 关闭服务
   */
  async shutdown(): Promise<void> {
    this.storage.stopAutoFlush();
    await this.storage.flush();
  }
}

// 单例导出
export const loggerService = new LoggerService();
```

### 6. src/services/logger/mod.ts
```typescript
export { loggerService, type LoggerServiceConfig } from "./logger-service.ts";
export { LogStorage, type LogStorageConfig } from "./log-storage.ts";
export { createLoggerHooks } from "./hooks.ts";
export { generateSummary, generateTimeline } from "./summarizer.ts";
export { analyzeFailures, findAlternativeRoutes } from "./failure-analyzer.ts";
```

## 终点状态（验收标准）

### 必须满足
- [ ] `loggerService.initialize()` 能正确初始化
- [ ] `getHooks()` 返回的 hooks 能被注入到 core/ 中
- [ ] 四级日志都能正确记录和查询
- [ ] `getSummary()` 能生成可读的摘要
- [ ] `analyzeFailures()` 能识别失败点并给出建议

### 测试场景
```typescript
// 1. 初始化
loggerService.initialize({ defaultLevel: "tool" });

// 2. 获取 hooks 并模拟调用
const hooks = loggerService.getHooks();
hooks.onToolStart("Bash", { command: "ls" });
hooks.onToolComplete("Bash", { stdout: "..." }, 100);
hooks.onToolError("Pip", new Error("Connection timeout"));

// 3. 查询日志
const logs = loggerService.query({ level: "tool" });
assert(logs.length >= 2);

// 4. 获取摘要
const summary = loggerService.getSummary();
assert(summary.includes("Bash"));

// 5. 分析失败
const failures = loggerService.analyzeFailures();
assert(failures.length >= 1);
assert(failures[0].suggestedFixes.length > 0);

// 6. 导出
const json = loggerService.export("json");
assert(JSON.parse(json).length >= 2);
```

### 交付物
1. `src/services/logger/log-storage.ts` - 日志存储
2. `src/services/logger/hooks.ts` - Hook 创建
3. `src/services/logger/summarizer.ts` - 摘要生成
4. `src/services/logger/failure-analyzer.ts` - 失败分析
5. `src/services/logger/logger-service.ts` - 主服务
6. `src/services/logger/mod.ts` - 统一导出

## 预估时间
2 天
