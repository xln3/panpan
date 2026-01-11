# Task 扩展为分类 Subagent (SA) 设计方案

## 目标
将现有的 Task tool 扩展为四种专门的 Subagent 类型：
1. **RemoteSA** - 远程执行隔离
2. **WatcherSA** - 资源监控
3. **PMSA** - 需求确认与验收
4. **LoggerSA** - 客观记录

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main Agent (协调者)                          │
│  - 接收用户输入，协调 SA 调用                                      │
│  - SA 可合作但不能嵌套（避免死循环）                               │
└───────────────┬─────────────────────────────────────────────────┘
                │
    ┌───────────┼───────────┬───────────────┬───────────────┐
    │           │           │               │               │
    ▼           ▼           ▼               ▼               ▼
┌──────────┐┌──────────┐┌──────────┐┌─────────────┐┌─────────────┐
│ Existing ││ RemoteSA ││ WatcherSA││    PMSA     ││  LoggerSA   │
│ (Explore,││ SSH+     ││ GPU/CPU/ ││ 需求确认    ││  (观察者)    │
│  Plan)   ││ Daemon   ││ Disk/... ││ + 验收      ││  记录所有    │
└──────────┘└──────────┘└──────────┘└─────────────┘└─────────────┘
                │           │               │               │
                └───────────┴───────────────┴───────────────┘
                                    │
                          ┌─────────┴─────────┐
                          │   共享状态         │
                          │  - EventBus       │
                          │  - LogStorage     │
                          └───────────────────┘
```

---

## Phase 1: LoggerSA（基础设施）

### 设计要点
LoggerSA 是**观察者模式**，通过 hook 注入被动记录，不是主动调用的 agent。

### 四级日志体系
| 级别 | 记录内容 | 用途 |
|------|---------|------|
| `summary` | 高层操作摘要（"读取了 5 个文件"） | 快速概览 |
| `tool` | Tool 输入/输出/耗时 | 调试工具问题 |
| `llm` | LLM 请求/响应/token 使用 | 调试提示词 |
| `full` | 全量包括流式输出 | 完整取证 |

### 新增文件
```
src/services/logger/
├── logger-service.ts   # 主服务，管理日志级别和存储
├── hooks.ts            # Hook 定义和注入
├── log-storage.ts      # 多级日志存储
├── summarizer.ts       # 摘要生成
└── failure-analyzer.ts # 失败分析，找替代路线

src/tools/logger/
├── mod.ts
├── logger-config.ts    # 配置日志级别
├── logger-query.ts     # 查询日志
└── logger-export.ts    # 导出日志

src/types/logger.ts     # 日志类型定义
```

### Hook 注入点（修改现有文件）
1. `src/core/query.ts` - 包裹 LLM 调用
2. `src/core/tool-executor.ts:302` - 扩展 `emitToolEvents()` 方法
3. `src/tools/task.ts` - 包裹 SA 调用

### 关键类型
```typescript
type LogLevel = "summary" | "tool" | "llm" | "full";

interface LogEntry {
  id: string;
  level: LogLevel;
  timestamp: number;
  type: "tool_call" | "llm_request" | "sa_invoke" | ...;
  data: unknown;
  success: boolean;
  error?: string;
}

interface FailurePoint {
  entryId: string;
  error: string;
  context: { previousSteps: string[]; };
  suggestedFixes: string[];  // 帮助找更可能成功的路线
}
```

---

## Phase 2: RemoteSA（远程执行）

### 设计要点
**混合模式**：SSH bootstrap → Daemon 通信

```
┌──────────┐         ┌─────────────┐         ┌──────────────┐
│  panpan  │   SSH   │   Target    │  HTTP/  │   panpan     │
│  client  │────────▶│   Server    │  WS     │   daemon     │
│          │         │             │◀────────│              │
└──────────┘         └─────────────┘         └──────────────┘

1. SSH Bootstrap: 上传 daemon → 启动 → 返回 port + token → 断开 SSH
2. Daemon 通信: HTTP/WebSocket + Bearer token
3. 清理: daemon 超时自动关闭
```

### 新增文件
```
src/services/remote/
├── connection-manager.ts  # 连接池管理
├── daemon-client.ts       # 与 daemon 通信
├── ssh-bootstrap.ts       # SSH 引导安装
└── daemon-binary.ts       # 内嵌 daemon 源码

src/tools/remote/
├── mod.ts
├── remote-connect.ts      # 连接服务器
├── remote-exec.ts         # 执行命令
├── remote-file.ts         # 文件操作
└── remote-disconnect.ts   # 断开连接

src/types/remote.ts
```

### 关键类型
```typescript
interface RemoteHost {
  id: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: "key" | "password" | "agent";
}

interface RemoteExecOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  host: string;  // 明确标记来源，避免混淆
}
```

### Daemon 设计
- Deno 单文件，~200 行
- 随机高端口 + 一次性 token
- 超时自动关闭（默认 30 分钟）
- 端点: `/exec`, `/file/read`, `/file/write`, `/health`

---

## Phase 3: WatcherSA（资源监控）

### 设计要点
**插件式监控器架构**，支持本地 + 远程

### 新增文件
```
src/services/watcher/
├── monitor-registry.ts    # 监控器注册表
├── alert-manager.ts       # 阈值告警
├── aggregator.ts          # 聚合本地+远程数据
└── monitors/
    ├── base.ts            # Monitor 接口
    ├── gpu.ts             # nvidia-smi
    ├── cpu.ts
    ├── memory.ts
    ├── disk.ts            # 包括 inodes
    ├── network.ts
    └── custom.ts          # 用户自定义

src/tools/watcher/
├── mod.ts
├── watcher-start.ts
├── watcher-stop.ts
├── watcher-status.ts
└── watcher-alert.ts

src/types/watcher.ts
```

### Monitor 插件接口
```typescript
interface Monitor {
  type: MonitorType;
  isAvailable(): Promise<boolean>;
  getCommand(): string;           // 用于远程执行
  parseOutput(stdout: string): MonitorReading;
}
```

### 远程监控
WatcherSA 通过 RemoteSA 的连接监控远程服务器：
```typescript
const result = await connectionManager.execute(connectionId, {
  command: gpuMonitor.getCommand(),
});
return gpuMonitor.parseOutput(result.stdout);
```

---

## Phase 4: PMSA（产品经理）

### 设计要点
完整的**需求 → 测试 → 验收**循环

### 工作流程
```
用户输入 ──▶ [1. Clarify] ──▶ [2. Plan] ──▶ [3. Execute] ──▶ [4. Verify]
               │                │              │               │
               ▼                ▼              ▼               ▼
           问答澄清          测试计划      主 Agent       运行测试
           + 替代方案         + 多路线        实现            │
                                                            │
                              ┌─────────────────────────────┘
                              ▼
                       通过？→ 完成
                       失败？→ 检查预算 → 在预算内？→ 尝试替代方案
                                      → 超预算？→ 通知用户
```

### 新增文件
```
src/services/pm/
├── requirements.ts       # 需求解析和跟踪
├── test-finder.ts        # 查找现有测试
├── test-generator.ts     # 生成测试模板
├── verification.ts       # 验收循环
└── budget-tracker.ts     # Token/时间限制追踪

src/tools/pm/
├── mod.ts
├── pm-clarify.ts         # 需求澄清问答
├── pm-testplan.ts        # 生成/查找测试
├── pm-verify.ts          # 运行验收
└── pm-status.ts          # 预算和进度

src/types/pm.ts
```

### 预算追踪
```typescript
interface PMBudget {
  tokenLimit: number;
  tokenUsed: number;
  timeLimit: number;   // ms
  timeUsed: number;
  attemptsUsed: number;
}

// 开始时询问用户设置 limit
// 达到 80% 时预警，达到 100% 时通知并停止
```

### 替代方案管理
```typescript
interface AlternativePlan {
  id: string;
  description: string;
  confidence: number;  // 0-1
  result?: "success" | "failed";
}

// 在 Clarify 阶段生成 3-5 个替代方案
// 主方案失败后自动切换
```

---

## 需要修改的现有文件

| 文件 | 修改内容 |
|------|---------|
| `src/types/agent.ts` | 添加 `persistent`, `hasBackgroundServices`, `requiresInit` 字段 |
| `src/utils/agent-loader.ts` | 添加 Remote, Watcher, PM agent 配置 |
| `src/tools/mod.ts` | 注册新工具 |
| `src/core/tool-executor.ts:302` | 扩展 `emitToolEvents()` 注入 Logger hooks |
| `src/core/query.ts` | 添加 LLM 调用的 Logger hooks |
| `src/tools/task.ts` | 添加 SA 调用的 Logger hooks |
| `src/services/mod.ts` | 新建，服务初始化入口 |

---

## 实现顺序（总览）

### 依赖关系图
```
┌─────────────────────────────────────────────────────────────────────────┐
│                        可并行开发的独立模块                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [A] types/           [B] diagnostics/      [C] remote/                 │
│  ├── logger.ts        ├── network.ts        ├── daemon.ts              │
│  ├── remote.ts        ├── config.ts         ├── connection-mgr.ts      │
│  ├── watcher.ts       ├── error.ts          └── ssh-bootstrap.ts       │
│  └── pm.ts            └── retry.ts                                      │
│                                                                         │
│  [D] logger/          [E] watcher/monitors/ [F] pm/                     │
│  ├── log-storage.ts   ├── base.ts           ├── requirements.ts        │
│  ├── summarizer.ts    ├── gpu.ts            ├── test-finder.ts         │
│  └── failure-analyzer ├── cpu.ts            ├── test-generator.ts      │
│                       ├── memory.ts         ├── verification.ts        │
│                       └── disk.ts           └── budget-tracker.ts      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        需要依赖的工具层                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [G] tools/remote/    [H] tools/logger/     [I] tools/watcher/         │
│  依赖: [A], [C]       依赖: [A], [D]        依赖: [A], [E]             │
│                                                                         │
│  [J] tools/pm/        [K] 现有工具增强                                  │
│  依赖: [A], [F]       依赖: [B] diagnostics/                           │
│  (Pip, Conda, Uv...)                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        最后集成（有顺序依赖）                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [L] core/query.ts + tool-executor.ts 修改                              │
│      依赖: [D] logger hooks                                             │
│                                                                         │
│  [M] utils/agent-loader.ts 添加新 SA 配置                               │
│      依赖: 所有 tools/ 完成                                             │
│                                                                         │
│  [N] tools/mod.ts 注册新工具                                            │
│      依赖: 所有 tools/ 完成                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 并行开发计划

**Sprint 1: 独立模块（可完全并行）** - 第 1-5 天
| 模块 ID | 路径 | 职责 | 预估 |
|---------|------|------|------|
| A | `src/types/{logger,remote,watcher,pm}.ts` | 类型定义 | 0.5 天 |
| B | `src/utils/diagnostics/*` | 网络/配置/错误诊断 | 2 天 |
| C | `src/services/remote/*` | SSH/Daemon 通信 | 3 天 |
| D | `src/services/logger/*` | 日志存储/摘要/分析 | 2 天 |
| E | `src/services/watcher/monitors/*` | GPU/CPU/Disk 监控器 | 2 天 |
| F | `src/services/pm/*` | 需求/测试/验收/预算 | 3 天 |

**Sprint 2: 工具层（依赖 Sprint 1）** - 第 3-8 天（可部分并行）
| 模块 ID | 路径 | 依赖 | 预估 |
|---------|------|------|------|
| G | `src/tools/remote/*` | A, C | 1.5 天 |
| H | `src/tools/logger/*` | A, D | 1 天 |
| I | `src/tools/watcher/*` | A, E | 1 天 |
| J | `src/tools/pm/*` | A, F | 1.5 天 |
| K | Pip/Conda/Uv/Pixi 增强 | B | 2 天 |

**Sprint 3: 集成（顺序执行）** - 第 8-10 天
| 模块 ID | 路径 | 依赖 | 预估 |
|---------|------|------|------|
| L | `src/core/query.ts`, `tool-executor.ts` | D, H | 1 天 |
| M | `src/utils/agent-loader.ts` | G, H, I, J | 0.5 天 |
| N | `src/tools/mod.ts` | G, H, I, J | 0.5 天 |

### 并行开发甘特图
```
天数:    1    2    3    4    5    6    7    8    9   10
        ├────┼────┼────┼────┼────┼────┼────┼────┼────┤
A types ████
B diag  ████████████
C remot ██████████████████
D logge ████████████
E watch ████████████
F pm    ██████████████████
                         G tools/remote  ██████████
                         H tools/logger  ██████
                         I tools/watcher ██████
                         J tools/pm      ██████████
                    K 工具增强           ████████████
                                                L 集成 ██████
                                                M agent████
                                                N mod  ████
```

### 模块接口契约

为了并行开发，需要先定义接口契约：

```typescript
// ===== types/diagnostics.ts (Sprint 1 开始前确定) =====
export interface NetworkDiagnosis { ... }
export interface ErrorDiagnosis { ... }
export interface Fix { ... }

// ===== types/logger.ts (Sprint 1 开始前确定) =====
export type LogLevel = "summary" | "tool" | "llm" | "full";
export interface LogEntry { ... }
export interface LoggerHooks { ... }

// ===== types/remote.ts (Sprint 1 开始前确定) =====
export interface RemoteHost { ... }
export interface RemoteConnection { ... }
export interface RemoteExecOutput { ... }

// ===== types/watcher.ts (Sprint 1 开始前确定) =====
export interface Monitor { ... }
export interface MonitorReading { ... }
export interface AlertConfig { ... }

// ===== types/pm.ts (Sprint 1 开始前确定) =====
export interface Requirement { ... }
export interface TestPlan { ... }
export interface PMBudget { ... }
```

### 独立验证点

每个模块完成后可独立验证：

| 模块 | 验证方式 |
|------|---------|
| B diagnostics | 单元测试：模拟超时错误，验证诊断结果 |
| C remote | 集成测试：连接本地 SSH，执行命令 |
| D logger | 单元测试：记录和查询日志 |
| E monitors | 单元测试：解析 nvidia-smi/top 输出 |
| F pm | 单元测试：需求解析、预算追踪 |
| G-J tools | 手动测试：通过 REPL 调用工具 |
| K 工具增强 | 集成测试：模拟网络错误，验证自动修复 |

总计：约 10-12 天（并行开发）vs 19-23 天（串行开发）

---

## 风险和注意事项

### RemoteSA
- **安全**: Daemon token 泄露风险 → 一次性 token + 短超时
- **防火墙**: 端口可能被封 → 提供 SSH tunnel 回退模式

### WatcherSA
- **性能**: 采样过频影响性能 → 默认间隔 1s
- **兼容性**: 不同系统命令不同 → `isAvailable()` 检查

### PMSA
- **无限循环**: 澄清问答可能死循环 → 最多 5 个问题
- **测试质量**: 生成的测试可能有误 → 标记为 "generated"，提示人工审查

### LoggerSA
- **性能开销**: full 级别日志影响性能 → 异步写入 + 可配置级别
- **存储膨胀**: 日志过大 → 最大条目限制 + 自动轮转

---

---

## Phase 0: 自动诊断修复基础设施（最高优先级）

### 问题背景
当前 agent 遇到网络/配置问题时会"甩锅"给用户：
```
## NEXT STEPS:
# With proxy
export HTTP_PROXY=http://your-proxy:port
huggingface-cli download stabilityai/sd-turbo
```

这是不好的行为。Agent 应该**自己尝试解决**，而不是让用户手动操作。

### 设计要点
**在工具内部实现"诊断→自动修复→重试"循环**，而不是依赖 LLM 多轮交互。

### 新增诊断模块
```
src/utils/diagnostics/
├── network-diagnostics.ts  # 网络连通性、DNS、代理检测
├── config-detector.ts      # 检测 ~/.pip/pip.conf, ~/.gitconfig, 环境变量等
├── error-classifier.ts     # 统一错误分类（参考 dataset-download.ts）
└── retry-policy.ts         # 重试策略：指数退避、镜像轮转
```

### 关键类型
```typescript
interface NetworkDiagnosis {
  networkReachable: boolean;
  dnsWorking: boolean;
  proxyConfigured: boolean;
  proxyUrl?: string;
  availableMirrors: string[];
  sslValid: boolean;
}

interface ErrorDiagnosis {
  type: "timeout" | "dns" | "ssl" | "http_error" | "permission" | "disk_full" | "unknown";
  autoFixable: boolean;
  suggestedFixes: Fix[];
  requiresUserInput: boolean;
  userQuestion?: string;  // 如果需要用户输入，问什么
}

interface Fix {
  description: string;
  action: () => Promise<void>;
  confidence: number;  // 0-1，修复成功的置信度
}
```

### 工具增强模式
```typescript
// 增强后的工具执行流程
async *call(input, context) {
  const maxAttempts = 3;
  let lastError: ErrorDiagnosis | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 1. 执行命令
    const result = await executeCommand(...);

    if (result.exitCode === 0) {
      yield { type: "result", data: result };
      return;
    }

    // 2. 诊断错误
    const diagnosis = await diagnoseError(result.stderr);
    lastError = diagnosis;

    // 3. 尝试自动修复
    if (diagnosis.autoFixable && diagnosis.suggestedFixes.length > 0) {
      const fix = diagnosis.suggestedFixes[0];
      yield { type: "progress", content: `尝试修复: ${fix.description}` };
      await fix.action();
      continue;  // 重试
    }

    // 4. 无法自动修复，跳出循环
    break;
  }

  // 5. 返回带诊断信息的错误
  yield {
    type: "result",
    data: {
      exitCode: 1,
      diagnosis: lastError,
      message: lastError?.requiresUserInput
        ? lastError.userQuestion
        : "已尝试自动修复但失败"
    }
  };
}
```

### 需要增强的工具
| 工具 | 增强内容 | 参考实现 |
|------|---------|---------|
| Pip | 超时→检测代理/镜像→自动切换清华源→重试 | dataset-download.ts:150-326 |
| Conda | 同上，加 conda 特有的 channel 配置 | - |
| Uv | 同上 | - |
| Pixi | 同上 | - |
| Bash | 检测常见失败模式（权限、缺少依赖、网络） | - |
| WebFetch | 代理检测、重试、降级到无 JavaScript 模式 | - |

### 配置检测优先级
```typescript
// config-detector.ts
async function detectProxyConfig(): Promise<string | undefined> {
  // 按优先级检测
  const sources = [
    () => Deno.env.get("HTTP_PROXY"),
    () => Deno.env.get("HTTPS_PROXY"),
    () => Deno.env.get("ALL_PROXY"),
    () => parseGitConfig("~/.gitconfig", "http.proxy"),
    () => parseCurlrc("~/.curlrc"),
    () => parseSystemProxy(),  // macOS/Linux 系统代理
  ];

  for (const source of sources) {
    const proxy = await source();
    if (proxy) return proxy;
  }
  return undefined;
}

async function detectMirrors(service: "pypi" | "huggingface" | "npm"): Promise<string[]> {
  const mirrors: Record<string, string[]> = {
    pypi: [
      "https://pypi.tuna.tsinghua.edu.cn/simple",
      "https://mirrors.aliyun.com/pypi/simple",
    ],
    huggingface: [
      "https://hf-mirror.com",
    ],
    npm: [
      "https://registry.npmmirror.com",
    ],
  };
  return mirrors[service] || [];
}
```

### 与 SA 的集成
```
工具执行失败
    ↓
工具内部诊断 + 自动修复尝试（最多 3 次）
    ↓
仍然失败？
    ↓
返回诊断结果给 Query Loop
    ↓
PMSA 决策：
  - diagnosis.requiresUserInput? → 询问用户
  - diagnosis.type == "disk_full"? → 调用 WatcherSA 检查磁盘
  - diagnosis.type == "permission"? → 调用 RemoteSA 检查权限
    ↓
LoggerSA 记录整个诊断过程
```

### 实现顺序
```
Phase 0.1: 创建诊断模块 (2 天)
├── network-diagnostics.ts
├── config-detector.ts
├── error-classifier.ts
└── retry-policy.ts

Phase 0.2: 增强 Pip 工具作为参考实现 (1 天)
└── 验证诊断→修复→重试流程

Phase 0.3: 推广到其他工具 (2 天)
├── Conda, Uv, Pixi
├── Bash (常见失败模式)
└── WebFetch (代理+重试)
```

---

## 验证方案

### Phase 0 验证（自动诊断修复）
```bash
# 测试场景：模拟网络超时
deno task run
> pip install some-nonexistent-package-xyz

# 期望行为：
# 1. 检测到超时/连接失败
# 2. 输出: "检测到网络问题，尝试修复: 切换到清华镜像源"
# 3. 自动重试
# 4. 如果仍然失败，输出带诊断的错误：
#    "已尝试: 1) 清华源 2) 阿里源，均失败。
#     诊断: DNS 解析成功，但连接超时。
#     建议: 你有可用的代理地址吗？"

# 而不是直接说 "请手动设置 HTTP_PROXY=xxx"
```

### 验证检查清单
- [ ] Pip 超时时自动尝试镜像源
- [ ] 检测到现有代理配置时自动应用
- [ ] 返回的错误包含完整诊断信息
- [ ] 诊断信息区分"可自动修复"和"需要用户输入"

### Phase 1 验证
```bash
# 1. 配置日志级别
# 2. 执行一些操作
# 3. 查询日志，验证四级都有记录
deno task run
> /logger-config level=tool
> /some-task
> /logger-query level=tool limit=10
```

### Phase 2 验证
```bash
# 1. 连接测试服务器
# 2. 执行命令，验证输出包含 hostname
# 3. 断开连接，验证 daemon 清理
deno task run
> 连接到 test@192.168.1.100
> 在远程执行 nvidia-smi
> 断开连接
```

### Phase 3 验证
```bash
# 1. 启动 GPU+CPU 监控
# 2. 设置告警阈值
# 3. 查看状态
deno task run
> 监控 GPU 和 CPU
> 当 GPU 使用率 > 80% 时告警
> 查看当前资源状态
```

### Phase 4 验证
```bash
# 1. 给一个模糊需求
# 2. PMSA 应该问澄清问题
# 3. 生成测试，执行验收
deno task run
> 帮我实现一个缓存功能
# 期望: PMSA 询问缓存类型、过期策略等
# 期望: 生成测试模板
# 期望: 实现后自动验收
```
