# 模块 K: 包管理工具诊断增强

## 整体背景

> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

本模块在现有的包管理工具（pip, conda, uv,
pixi）中集成诊断逻辑，实现自动重试和镜像切换，解决 agent "甩锅给用户"的问题。

## 问题背景

当前行为（坏的）:

```
pip install torch
→ ReadTimeoutError: HTTPSConnectionPool - Read timed out
→ "请检查网络连接或尝试使用代理"
```

期望行为（好的）:

```
pip install torch
→ ReadTimeoutError (第1次尝试)
→ 自动诊断: 网络超时，尝试清华镜像
→ pip install torch -i https://pypi.tuna.tsinghua.edu.cn/simple
→ 成功安装
```

## 依赖关系

- **依赖**: B (diagnostics) - `src/utils/diagnostics/`
- **被依赖**: 无（终端模块）

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     Package Manager Tool                         │
│                    (pip.ts / conda.ts / uv.ts)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              DiagnosticExecutor (新增)                    │   │
│  │  ┌──────────┐  ┌─────────────┐  ┌──────────────────┐    │   │
│  │  │ 执行命令  │→│ 失败时诊断   │→│ 应用修复并重试    │    │   │
│  │  └──────────┘  └─────────────┘  └──────────────────┘    │   │
│  │        ↑              │                   │              │   │
│  │        └──────────────┴───────────────────┘              │   │
│  │                    (重试循环)                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                   │
│                     ┌────────────────┐                          │
│                     │ 最终结果/失败报告│                          │
│                     └────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                   src/utils/diagnostics/                         │
├─────────────────────────────────────────────────────────────────┤
│  classifyError()   →  识别错误类型 (timeout/dns/ssl/permission)  │
│  shouldRetry()     →  判断是否重试 + 选择修复方案                │
│  applyFix()        →  应用修复 (设置环境变量/镜像)               │
│  getMirrors()      →  获取各服务的镜像列表                       │
└─────────────────────────────────────────────────────────────────┘
```

## 文件结构

```
src/tools/package-managers/
├── common.ts                  # 现有：流式执行、超时配置
├── diagnostic-executor.ts     # 新增：诊断执行器
├── mirror-configs.ts          # 新增：各工具镜像配置
├── pip.ts                     # 修改：集成诊断执行器
├── conda.ts                   # 修改：集成诊断执行器
├── uv.ts                      # 修改：集成诊断执行器
├── pixi.ts                    # 修改：集成诊断执行器
└── mod.ts                     # 现有：导出
```

## 详细设计

### 1. src/tools/package-managers/diagnostic-executor.ts

```typescript
import {
  applyFix,
  classifyError,
  createRetryContext,
  type RetryContext,
  shouldRetry,
  updateRetryContext,
} from "../../utils/diagnostics/mod.ts";
import { type CommandResult, executeCommandStreaming } from "./common.ts";

/**
 * 诊断执行配置
 */
export interface DiagnosticExecutorConfig {
  tool: "pip" | "conda" | "uv" | "pixi";
  maxAttempts: number;
  getMirrorArgs: (mirrorUrl: string) => string[];
}

/**
 * 诊断执行结果
 */
export interface DiagnosticResult extends CommandResult {
  attempts: number;
  appliedFixes: string[];
  diagnosis?: {
    type: string;
    autoFixable: boolean;
    userQuestion?: string;
  };
}

/**
 * 带诊断的命令执行器
 *
 * 核心流程：
 * 1. 执行命令
 * 2. 如果失败，诊断错误
 * 3. 如果可自动修复，应用修复并重试
 * 4. 重复直到成功或预算耗尽
 */
export async function* executeWithDiagnostics(
  baseCommand: string[],
  cwd: string,
  timeout: number,
  abortController: AbortController,
  config: DiagnosticExecutorConfig,
): AsyncGenerator<
  | { stream: "stdout" | "stderr"; line: string; timestamp: number }
  | { type: "progress"; message: string }
  | DiagnosticResult
> {
  let retryContext = createRetryContext();
  let currentCommand = [...baseCommand];
  let lastResult: CommandResult | undefined;

  while (retryContext.attempt < config.maxAttempts) {
    // ========== 1. 输出重试信息 ==========
    if (retryContext.attempt > 0) {
      yield {
        type: "progress",
        message: `重试 #${retryContext.attempt + 1}: ${
          currentCommand.join(" ")
        }`,
      };
    }

    // ========== 2. 执行当前命令 ==========
    for await (
      const item of executeCommandStreaming(
        currentCommand,
        cwd,
        timeout,
        abortController,
      )
    ) {
      if ("stream" in item) {
        yield item; // 流式输出
      } else {
        lastResult = item; // 最终结果
      }
    }

    // ========== 3. 成功则返回 ==========
    if (lastResult && lastResult.exitCode === 0) {
      yield {
        ...lastResult,
        attempts: retryContext.attempt + 1,
        appliedFixes: retryContext.appliedFixes,
      };
      return;
    }

    // ========== 4. 失败则诊断 ==========
    const diagnosis = await classifyError(
      lastResult?.stderr || "",
      { tool: config.tool },
    );

    // ========== 5. 判断是否可重试 ==========
    const retryDecision = shouldRetry(retryContext, diagnosis);

    if (!retryDecision.shouldRetry || !retryDecision.nextFix) {
      // 无法自动修复，返回带诊断的失败结果
      yield {
        ...(lastResult || emptyResult()),
        attempts: retryContext.attempt + 1,
        appliedFixes: retryContext.appliedFixes,
        diagnosis: {
          type: diagnosis.type,
          autoFixable: diagnosis.autoFixable,
          userQuestion: diagnosis.userQuestion,
        },
      };
      return;
    }

    // ========== 6. 应用修复 ==========
    const { nextFix, delayMs } = retryDecision;

    yield {
      type: "progress",
      message: `诊断: ${diagnosis.type}, 尝试修复: ${nextFix.description}`,
    };

    // 应用环境变量修复
    await applyFix(nextFix);

    // 如果是镜像修复，修改命令参数
    if (nextFix.action.type === "use_mirror") {
      currentCommand = [
        ...baseCommand,
        ...config.getMirrorArgs(nextFix.action.url),
      ];
    }

    // ========== 7. 更新重试上下文，等待后继续 ==========
    retryContext = updateRetryContext(retryContext, nextFix, delayMs);

    if (delayMs > 0) {
      yield {
        type: "progress",
        message: `等待 ${delayMs / 1000}s 后重试...`,
      };
      await delay(delayMs);
    }
  }

  // 达到最大重试次数
  yield {
    ...(lastResult || emptyResult()),
    attempts: retryContext.attempt,
    appliedFixes: retryContext.appliedFixes,
    diagnosis: {
      type: "max_retries_exceeded",
      autoFixable: false,
      userQuestion: `已尝试 ${retryContext.attempt} 次，所有自动修复均失败`,
    },
  };
}

function emptyResult(): CommandResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: -1,
    durationMs: 0,
    timedOut: false,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 2. src/tools/package-managers/mirror-configs.ts

```typescript
/**
 * 各工具的镜像配置
 */
export interface MirrorConfig {
  service: "pypi" | "conda";
  getMirrorArgs: (url: string) => string[];
}

export const MIRROR_CONFIGS: Record<string, MirrorConfig> = {
  pip: {
    service: "pypi",
    getMirrorArgs: (url) => [
      "-i",
      url,
      "--trusted-host",
      new URL(url).hostname,
    ],
  },

  uv: {
    service: "pypi",
    getMirrorArgs: (url) => ["--index-url", url],
  },

  conda: {
    service: "conda",
    // conda 使用 -c 指定 channel
    getMirrorArgs: (url) => ["-c", url, "--override-channels"],
  },

  pixi: {
    service: "conda",
    // pixi 继承 conda 的 channel 概念
    getMirrorArgs: (url) => ["--channel", url],
  },
};

/**
 * 镜像列表
 */
export const MIRRORS: Record<string, string[]> = {
  pypi: [
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://mirrors.aliyun.com/pypi/simple",
    "https://pypi.mirrors.ustc.edu.cn/simple",
  ],
  conda: [
    "https://mirrors.tuna.tsinghua.edu.cn/anaconda/pkgs/main",
    "https://mirrors.aliyun.com/anaconda/pkgs/main",
  ],
};
```

### 3. pip.ts 修改

```typescript
// src/tools/package-managers/pip.ts

import { z } from "zod";
import type { Tool, ToolContext, ToolYield } from "../../types/tool.ts";
import {
  buildPipCommand,
  type CommandResult,
  executeCommandStreaming,
  formatResultForAssistant,
  TIMEOUTS,
} from "./common.ts";
import {
  type DiagnosticResult,
  executeWithDiagnostics,
} from "./diagnostic-executor.ts";
import { MIRROR_CONFIGS } from "./mirror-configs.ts";

// ... inputSchema 保持不变 ...

interface Output extends CommandResult {
  operation: string;
  attempts?: number;
  appliedFixes?: string[];
}

export const PipTool: Tool<typeof inputSchema, Output> = {
  name: "Pip",
  description:
    `Python package manager with automatic retry and mirror switching.

Operations:
- install: Install packages (auto-retries with mirrors on timeout)
- uninstall: Remove packages
- list/freeze/show: Query operations (no retry needed)

Features:
- Automatic timeout detection and mirror switching
- Supports Tsinghua, Aliyun, USTC mirrors
- Detailed diagnostics on failure`,

  inputSchema,

  isReadOnly: (input) => {
    if (!input?.operation) return false;
    return ["list", "freeze", "show"].includes(input.operation);
  },

  isConcurrencySafe: (input) => {
    if (!input?.operation) return false;
    return ["list", "freeze", "show"].includes(input.operation);
  },

  async *call(
    input: Input,
    context: ToolContext,
  ): AsyncGenerator<ToolYield<Output>> {
    const timeout = getTimeout(input.operation);
    const cmd = buildCommand(input);

    // 只读操作不需要诊断增强
    const isReadOnly = ["list", "freeze", "show"].includes(input.operation);

    if (isReadOnly) {
      // 使用原有的简单执行逻辑
      let result: CommandResult | undefined;
      for await (
        const item of executeCommandStreaming(
          cmd,
          context.cwd,
          timeout,
          context.abortController,
        )
      ) {
        if ("stream" in item) {
          yield { type: "streaming_output", line: item };
        } else {
          result = item;
        }
      }

      const output: Output = {
        operation: input.operation,
        ...(result ||
          {
            stdout: "",
            stderr: "",
            exitCode: -1,
            durationMs: 0,
            timedOut: false,
          }),
      };

      yield {
        type: "result",
        data: output,
        resultForAssistant: this.renderResultForAssistant(output),
      };
      return;
    }

    // ========== 写操作：使用诊断增强执行 ==========
    if (context.outputDisplay) {
      context.outputDisplay.start(`pip ${input.operation}`, timeout);
    }

    let result: DiagnosticResult | undefined;

    for await (
      const item of executeWithDiagnostics(
        cmd,
        context.cwd,
        timeout,
        context.abortController,
        {
          tool: "pip",
          maxAttempts: 3,
          getMirrorArgs: MIRROR_CONFIGS.pip.getMirrorArgs,
        },
      )
    ) {
      if ("stream" in item) {
        yield { type: "streaming_output", line: item };
      } else if ("type" in item && item.type === "progress") {
        yield { type: "progress", content: item.message };
      } else {
        result = item as DiagnosticResult;
      }
    }

    if (context.outputDisplay) {
      context.outputDisplay.stop();
    }

    // ========== 构造输出 ==========
    const output: Output = {
      operation: input.operation,
      stdout: result?.stdout || "",
      stderr: result?.stderr || "",
      exitCode: result?.exitCode ?? -1,
      durationMs: result?.durationMs || 0,
      timedOut: result?.timedOut || false,
      attempts: result?.attempts,
      appliedFixes: result?.appliedFixes,
    };

    // 构造助手消息
    let assistantMessage = this.renderResultForAssistant(output);
    if (result?.diagnosis?.userQuestion) {
      assistantMessage += `\n\n⚠️ ${result.diagnosis.userQuestion}`;
    }
    if (result?.appliedFixes?.length) {
      assistantMessage += `\n\n已尝试修复: ${result.appliedFixes.join(", ")}`;
    }

    yield {
      type: "result",
      data: output,
      resultForAssistant: assistantMessage,
    };
  },

  renderResultForAssistant(output: Output): string {
    let result = formatResultForAssistant(output, `pip ${output.operation}`);
    if (output.attempts && output.attempts > 1) {
      result += `\n(共尝试 ${output.attempts} 次)`;
    }
    return result;
  },
  // ... renderToolUseMessage 保持不变 ...
};
```

## 错误类型与修复策略

| 错误类型   | 自动修复 | 修复策略                                  |
| ---------- | -------- | ----------------------------------------- |
| timeout    | ✅       | 1. 应用已配置代理 2. 尝试镜像 3. 增加超时 |
| dns        | ❌       | 需要用户检查网络/DNS                      |
| ssl        | ⚠️       | 可尝试 --trusted-host，但需谨慎           |
| http_4xx   | ❌       | 需要用户提供认证                          |
| http_5xx   | ✅       | 等待后重试 + 尝试镜像                     |
| permission | ❌       | 需要用户处理权限                          |
| disk_full  | ❌       | 需要用户清理磁盘                          |

## 执行流程示例

```
用户: pip install torch

┌─ 第1次尝试 ─────────────────────────────────────────┐
│ 执行: pip install torch                              │
│ 结果: ReadTimeoutError                              │
│ 诊断: type=timeout, autoFixable=true                │
│ 修复: use_mirror → https://pypi.tuna.tsinghua.edu.cn│
└─────────────────────────────────────────────────────┘
                          ↓
┌─ 第2次尝试 ─────────────────────────────────────────┐
│ 执行: pip install torch -i https://pypi.tuna...     │
│ 结果: 成功 (exitCode=0)                             │
│ 返回: { exitCode: 0, attempts: 2,                   │
│        appliedFixes: ["use_mirror_tsinghua"] }      │
└─────────────────────────────────────────────────────┘
```

## 终点状态（验收标准）

### 必须满足

- [ ] pip install 超时时自动尝试清华镜像
- [ ] conda install 超时时自动尝试镜像
- [ ] uv pip install 超时时自动尝试镜像
- [ ] pixi add 超时时自动尝试镜像
- [ ] 每次重试都通过 streaming 输出通知用户
- [ ] 失败时返回详细诊断信息
- [ ] 只读操作（list/freeze/show）不触发重试逻辑

### 测试场景

```typescript
// 1. 模拟超时场景
// 设置一个会超时的 mock 服务器
const result = await runPipInstall("fake-package", { timeout: 100 });
assert(result.attempts > 1);
assert(result.appliedFixes.includes("use_mirror_tsinghua"));

// 2. 验证镜像参数正确
const cmd = buildCommandWithMirror("pip", "https://pypi.tuna...");
assert(cmd.includes("-i"));
assert(cmd.includes("--trusted-host"));

// 3. 验证只读操作不重试
const listResult = await runPipList();
assert(listResult.attempts === undefined);
```

### 交付物

1. `src/tools/package-managers/diagnostic-executor.ts` - 诊断执行器
2. `src/tools/package-managers/mirror-configs.ts` - 镜像配置
3. `src/tools/package-managers/pip.ts` - 修改后的 pip 工具
4. `src/tools/package-managers/conda.ts` - 修改后的 conda 工具
5. `src/tools/package-managers/uv.ts` - 修改后的 uv 工具
6. `src/tools/package-managers/pixi.ts` - 修改后的 pixi 工具

## 预估时间

2 天
