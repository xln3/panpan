# 模块 A: 类型定义

## 整体背景

> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

本模块定义所有新 SA 的 TypeScript 类型接口，是其他所有模块的基础依赖。

## 模块职责

- 定义 Logger、Remote、Watcher、PM 四个 SA 的类型
- 定义诊断相关类型
- 扩展现有 AgentConfig 接口

## 依赖关系

- **依赖**: 无（可立即开始）
- **被依赖**: 所有其他模块

## 文件结构

```
src/types/
├── agent.ts         # 修改：扩展 AgentConfig
├── diagnostics.ts   # 新建
├── logger.ts        # 新建
├── remote.ts        # 新建
├── watcher.ts       # 新建
└── pm.ts            # 新建
```

## 详细设计

### 1. src/types/diagnostics.ts

```typescript
/**
 * 网络诊断结果
 */
export interface NetworkDiagnosis {
  networkReachable: boolean;
  dnsWorking: boolean;
  proxyConfigured: boolean;
  proxyUrl?: string;
  availableMirrors: string[];
  sslValid: boolean;
}

/**
 * 错误诊断结果
 */
export interface ErrorDiagnosis {
  type: ErrorType;
  autoFixable: boolean;
  suggestedFixes: Fix[];
  requiresUserInput: boolean;
  userQuestion?: string;
}

export type ErrorType =
  | "timeout"
  | "dns"
  | "ssl"
  | "http_error"
  | "permission"
  | "disk_full"
  | "dependency_missing"
  | "unknown";

/**
 * 修复建议
 */
export interface Fix {
  id: string;
  description: string;
  confidence: number; // 0-1
  action: FixAction;
}

export type FixAction =
  | { type: "set_env"; key: string; value: string }
  | { type: "use_mirror"; url: string }
  | { type: "retry_with_timeout"; timeoutMs: number }
  | { type: "custom"; command: string };
```

### 2. src/types/logger.ts

```typescript
/**
 * 日志级别
 */
export type LogLevel = "summary" | "tool" | "llm" | "full";

/**
 * 日志条目类型
 */
export type LogEntryType =
  | "user_input"
  | "llm_request"
  | "llm_response"
  | "tool_call"
  | "tool_result"
  | "sa_invoke"
  | "sa_result"
  | "diagnosis"
  | "fix_attempt"
  | "abort"
  | "error";

/**
 * 基础日志条目
 */
export interface LogEntry {
  id: string;
  level: LogLevel;
  timestamp: number;
  type: LogEntryType;
  data: unknown;
  duration?: number;
  success: boolean;
  error?: string;
}

/**
 * 摘要日志条目
 */
export interface SummaryLogEntry {
  timestamp: number;
  action: string;
  success: boolean;
  duration: number;
}

/**
 * 工具日志条目
 */
export interface ToolLogEntry extends LogEntry {
  type: "tool_call" | "tool_result";
  data: {
    toolName: string;
    input: Record<string, unknown>;
    output?: unknown;
    durationMs: number;
  };
}

/**
 * LLM 日志条目
 */
export interface LLMLogEntry extends LogEntry {
  type: "llm_request" | "llm_response";
  data: {
    model: string;
    tokens: { prompt: number; completion: number };
    cost: number;
    content?: string;
  };
}

/**
 * 失败分析点
 */
export interface FailurePoint {
  entryId: string;
  type: string;
  error: string;
  context: {
    previousSteps: string[];
    toolState: Record<string, unknown>;
  };
  suggestedFixes: string[];
}

/**
 * Logger hooks 接口
 */
export interface LoggerHooks {
  onQueryStart(messages: unknown[]): void;
  onLLMRequest(messages: unknown[], systemPrompt: string[]): void;
  onLLMResponse(response: unknown, durationMs: number): void;
  onQueryEnd(finalMessage: unknown): void;
  onToolStart(toolName: string, input: unknown): void;
  onToolProgress(toolName: string, progress: string): void;
  onToolComplete(toolName: string, result: unknown, durationMs: number): void;
  onToolError(toolName: string, error: Error): void;
  onSAInvoke(agentType: string, prompt: string): void;
  onSAComplete(agentType: string, result: string): void;
  onAbort(reason: string): void;
}
```

### 3. src/types/remote.ts

```typescript
/**
 * 远程主机配置
 */
export interface RemoteHost {
  id: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: "key" | "password" | "agent";
  keyPath?: string;
  fingerprint?: string;
}

/**
 * 远程连接状态
 */
export interface RemoteConnection {
  host: RemoteHost;
  status: "connecting" | "bootstrapping" | "ready" | "error";
  daemonPort?: number;
  daemonPid?: number;
  connectedAt?: number;
  lastActivity?: number;
  error?: string;
}

/**
 * Daemon 信息
 */
export interface DaemonInfo {
  version: string;
  pid: number;
  port: number;
  startedAt: number;
  capabilities: ("exec" | "file" | "watch")[];
}

/**
 * 远程执行输入
 */
export interface RemoteExecInput {
  connectionId: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  stream?: boolean;
}

/**
 * 远程执行输出
 */
export interface RemoteExecOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  host: string; // 始终包含主机名，避免混淆
}

/**
 * 远程文件操作输入
 */
export interface RemoteFileInput {
  connectionId: string;
  path: string;
  content?: string; // 写入时需要
}
```

### 4. src/types/watcher.ts

```typescript
/**
 * 监控类型
 */
export type MonitorType =
  | "gpu"
  | "cpu"
  | "memory"
  | "disk"
  | "network"
  | "io"
  | "inodes"
  | "custom";

/**
 * 监控配置
 */
export interface MonitorConfig {
  id: string;
  type: MonitorType;
  target: "local" | { remote: string };
  interval: number; // ms
  enabled: boolean;
  customCommand?: string;
  customParser?: string;
}

/**
 * 监控读数
 */
export interface MonitorReading {
  monitorId: string;
  type: MonitorType;
  target: string;
  timestamp: number;
  values: Record<string, number | string>;
}

/**
 * 告警配置
 */
export interface AlertConfig {
  id: string;
  monitorId: string;
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==";
  threshold: number;
  message: string;
  cooldown: number; // ms
}

/**
 * 告警实例
 */
export interface Alert {
  alertConfig: AlertConfig;
  reading: MonitorReading;
  triggeredAt: number;
  acknowledged: boolean;
}

/**
 * Monitor 接口（监控器插件需实现）
 */
export interface Monitor {
  type: MonitorType;
  name: string;
  description: string;
  isAvailable(): Promise<boolean>;
  sample(): Promise<MonitorReading>;
  getCommand(): string;
  parseOutput(stdout: string): MonitorReading;
}
```

### 5. src/types/pm.ts

```typescript
/**
 * 需求定义
 */
export interface Requirement {
  id: string;
  original: string;
  clarified: string;
  acceptance: string[];
  questions: QA[];
  status: "draft" | "clarified" | "verified" | "rejected";
}

export interface QA {
  question: string;
  answer: string;
  timestamp: number;
}

/**
 * 测试计划
 */
export interface TestPlan {
  requirements: string[];
  tests: TestCase[];
  generatedAt: number;
}

export interface TestCase {
  id: string;
  requirementId: string;
  type: "existing" | "generated";
  path?: string;
  template?: string;
  status: "pending" | "passed" | "failed";
  lastRun?: number;
  error?: string;
}

/**
 * 预算追踪
 */
export interface PMBudget {
  tokenLimit: number;
  tokenUsed: number;
  timeLimit: number; // ms
  timeUsed: number;
  attemptsLimit: number;
  attemptsUsed: number;
}

/**
 * 替代方案
 */
export interface AlternativePlan {
  id: string;
  description: string;
  confidence: number;
  triedAt?: number;
  result?: "success" | "failed";
  failureReason?: string;
}

/**
 * PM 工具输入类型
 */
export interface PMClarifyInput {
  requirements: string;
  autoAsk?: boolean;
}

export interface PMTestPlanInput {
  requirementIds: string[];
  searchExisting?: boolean;
  generateNew?: boolean;
}

export interface PMVerifyInput {
  testIds?: string[];
  failFast?: boolean;
  maxRetries?: number;
}

export interface PMStatusInput {
  includeAlternatives?: boolean;
}
```

### 6. src/types/agent.ts (修改)

```typescript
// 在现有 AgentConfig 接口中添加：

export interface AgentConfig {
  name: string;
  whenToUse: string;
  tools: string[] | "*";
  disallowedTools?: string[];
  model?: AgentModel;
  systemPrompt: string;
  // === 新增字段 ===
  persistent?: boolean; // 跨调用保持状态
  hasBackgroundServices?: boolean; // 运行后台服务
  requiresInit?: boolean; // 使用前需要初始化
}
```

## 终点状态（验收标准）

### 必须满足

- [ ] 所有类型文件通过 `deno check` 类型检查
- [ ] 每个类型都有 JSDoc 注释说明用途
- [ ] 接口命名清晰，符合项目约定
- [ ] 没有 `any` 类型（除非有充分理由）

### 验收命令

```bash
# 类型检查
deno check src/types/diagnostics.ts
deno check src/types/logger.ts
deno check src/types/remote.ts
deno check src/types/watcher.ts
deno check src/types/pm.ts

# 确保可以被其他模块导入
deno check src/types/mod.ts  # 需要创建导出文件
```

### 交付物

1. `src/types/diagnostics.ts` - 诊断相关类型
2. `src/types/logger.ts` - 日志相关类型
3. `src/types/remote.ts` - 远程相关类型
4. `src/types/watcher.ts` - 监控相关类型
5. `src/types/pm.ts` - PM 相关类型
6. `src/types/agent.ts` - 修改后的 agent 类型
7. `src/types/mod.ts` - 统一导出

## 预估时间

0.5 天
