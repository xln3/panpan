# 模块 B: 诊断工具

## 整体背景

> 本模块是 SA 扩展项目的一部分。完整架构见 `00-overview.md`。

本模块实现自动诊断修复基础设施，解决 agent
"甩锅给用户"的问题。当工具执行失败时，自动诊断原因并尝试修复，而不是让用户手动操作。

## 问题示例（坏的行为）

```
## NEXT STEPS:
# With proxy
export HTTP_PROXY=http://your-proxy:port
huggingface-cli download stabilityai/sd-turbo
```

## 期望行为

1. 检测到下载失败
2. 自动诊断：代理配置？镜像可用？DNS 问题？
3. 自动尝试修复
4. 如果都失败，带着具体诊断信息询问用户

## 依赖关系

- **依赖**: 无（可立即开始）
- **类型依赖**: `src/types/diagnostics.ts`（可先开发，后导入）
- **被依赖**: Sprint 2 的工具增强 (K)

## 文件结构

```
src/utils/diagnostics/
├── mod.ts               # 统一导出
├── network-diagnostics.ts  # 网络连通性检测
├── config-detector.ts      # 配置文件检测
├── error-classifier.ts     # 错误分类
└── retry-policy.ts         # 重试策略
```

## 详细设计

### 1. src/utils/diagnostics/network-diagnostics.ts

```typescript
import type { NetworkDiagnosis } from "../../types/diagnostics.ts";

/**
 * 执行完整的网络诊断
 */
export async function diagnoseNetwork(
  targetUrl?: string,
): Promise<NetworkDiagnosis> {
  const results: NetworkDiagnosis = {
    networkReachable: false,
    dnsWorking: false,
    proxyConfigured: false,
    availableMirrors: [],
    sslValid: true,
  };

  // 1. 检查基本网络连接
  results.networkReachable = await checkNetworkReachable();

  // 2. 检查 DNS
  results.dnsWorking = await checkDNS(targetUrl);

  // 3. 检查代理配置
  const proxyConfig = await detectProxyConfig();
  if (proxyConfig) {
    results.proxyConfigured = true;
    results.proxyUrl = proxyConfig;
  }

  // 4. 检查可用镜像
  results.availableMirrors = await detectAvailableMirrors(targetUrl);

  // 5. 检查 SSL（如果提供了 URL）
  if (targetUrl?.startsWith("https://")) {
    results.sslValid = await checkSSL(targetUrl);
  }

  return results;
}

/**
 * 检查基本网络连接
 */
async function checkNetworkReachable(): Promise<boolean> {
  try {
    // 尝试连接几个可靠的地址
    const testUrls = [
      "https://www.baidu.com",
      "https://www.google.com",
      "https://1.1.1.1",
    ];

    for (const url of testUrls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        await fetch(url, {
          method: "HEAD",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 检查 DNS 解析
 */
async function checkDNS(targetUrl?: string): Promise<boolean> {
  if (!targetUrl) return true;

  try {
    const url = new URL(targetUrl);
    // Deno 可以使用 Deno.resolveDns
    const results = await Deno.resolveDns(url.hostname, "A");
    return results.length > 0;
  } catch {
    return false;
  }
}

/**
 * 检查 SSL 证书
 */
async function checkSSL(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return !(
        msg.includes("certificate") ||
        msg.includes("ssl") ||
        msg.includes("tls")
      );
    }
    return true;
  }
}

/**
 * 检测可用镜像
 */
async function detectAvailableMirrors(targetUrl?: string): Promise<string[]> {
  if (!targetUrl) return [];

  const url = new URL(targetUrl);
  const hostname = url.hostname;

  // 根据目标主机返回可用镜像
  const mirrorMap: Record<string, string[]> = {
    "pypi.org": [
      "https://pypi.tuna.tsinghua.edu.cn/simple",
      "https://mirrors.aliyun.com/pypi/simple",
    ],
    "files.pythonhosted.org": [
      "https://pypi.tuna.tsinghua.edu.cn/simple",
    ],
    "huggingface.co": [
      "https://hf-mirror.com",
    ],
    "registry.npmjs.org": [
      "https://registry.npmmirror.com",
    ],
    "github.com": [
      "https://ghproxy.com",
    ],
  };

  return mirrorMap[hostname] || [];
}

export { detectProxyConfig } from "./config-detector.ts";
```

### 2. src/utils/diagnostics/config-detector.ts

```typescript
/**
 * 检测系统中配置的代理
 */
export async function detectProxyConfig(): Promise<string | undefined> {
  // 按优先级检测
  const sources = [
    // 1. 环境变量
    () => Deno.env.get("HTTP_PROXY"),
    () => Deno.env.get("HTTPS_PROXY"),
    () => Deno.env.get("ALL_PROXY"),
    () => Deno.env.get("http_proxy"),
    () => Deno.env.get("https_proxy"),
    () => Deno.env.get("all_proxy"),

    // 2. Git 配置
    () => parseGitConfig("http.proxy"),
    () => parseGitConfig("https.proxy"),

    // 3. curl 配置
    () => parseCurlrc(),

    // 4. pip 配置
    () => parsePipConfig(),
  ];

  for (const source of sources) {
    try {
      const proxy = await source();
      if (proxy && isValidProxyUrl(proxy)) {
        return proxy;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

/**
 * 解析 Git 配置
 */
async function parseGitConfig(key: string): Promise<string | undefined> {
  try {
    const command = new Deno.Command("git", {
      args: ["config", "--global", key],
      stdout: "piped",
      stderr: "null",
    });
    const { success, stdout } = await command.output();
    if (success) {
      const value = new TextDecoder().decode(stdout).trim();
      return value || undefined;
    }
  } catch {
    // Git 不可用
  }
  return undefined;
}

/**
 * 解析 ~/.curlrc
 */
async function parseCurlrc(): Promise<string | undefined> {
  try {
    const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
    if (!home) return undefined;

    const curlrcPath = `${home}/.curlrc`;
    const content = await Deno.readTextFile(curlrcPath);

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("proxy=") || trimmed.startsWith("proxy ")) {
        const proxy = trimmed.replace(/^proxy[= ]/, "").trim();
        return proxy || undefined;
      }
    }
  } catch {
    // 文件不存在
  }
  return undefined;
}

/**
 * 解析 pip 配置
 */
async function parsePipConfig(): Promise<string | undefined> {
  try {
    const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
    if (!home) return undefined;

    const pipConfPaths = [
      `${home}/.pip/pip.conf`,
      `${home}/.config/pip/pip.conf`,
      `${home}/pip/pip.ini`,
    ];

    for (const path of pipConfPaths) {
      try {
        const content = await Deno.readTextFile(path);
        const match = content.match(/proxy\s*=\s*(.+)/i);
        if (match) {
          return match[1].trim();
        }
      } catch {
        continue;
      }
    }
  } catch {
    // 配置不存在
  }
  return undefined;
}

/**
 * 验证代理 URL 格式
 */
function isValidProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "socks5:", "socks4:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 获取服务的镜像列表
 */
export function getMirrors(
  service: "pypi" | "huggingface" | "npm" | "github",
): string[] {
  const mirrors: Record<string, string[]> = {
    pypi: [
      "https://pypi.tuna.tsinghua.edu.cn/simple",
      "https://mirrors.aliyun.com/pypi/simple",
      "https://pypi.mirrors.ustc.edu.cn/simple",
    ],
    huggingface: [
      "https://hf-mirror.com",
    ],
    npm: [
      "https://registry.npmmirror.com",
    ],
    github: [
      "https://ghproxy.com",
      "https://mirror.ghproxy.com",
    ],
  };

  return mirrors[service] || [];
}

/**
 * 获取 pip 镜像的环境变量设置
 */
export function getPipMirrorEnv(mirrorUrl: string): Record<string, string> {
  return {
    PIP_INDEX_URL: mirrorUrl,
    PIP_TRUSTED_HOST: new URL(mirrorUrl).hostname,
  };
}
```

### 3. src/utils/diagnostics/error-classifier.ts

```typescript
import type {
  ErrorDiagnosis,
  ErrorType,
  Fix,
} from "../../types/diagnostics.ts";
import {
  detectProxyConfig,
  getMirrors,
  getPipMirrorEnv,
} from "./config-detector.ts";

/**
 * 分类错误并生成修复建议
 */
export async function classifyError(
  stderr: string,
  context: {
    command?: string;
    tool?: "pip" | "conda" | "uv" | "npm" | "git" | "curl" | "wget";
    url?: string;
  } = {},
): Promise<ErrorDiagnosis> {
  const stderrLower = stderr.toLowerCase();

  // 1. 超时错误
  if (
    stderrLower.includes("timed out") ||
    stderrLower.includes("timeout") ||
    stderrLower.includes("read timeout") ||
    stderrLower.includes("connection timeout")
  ) {
    return await buildTimeoutDiagnosis(context);
  }

  // 2. DNS 错误
  if (
    stderrLower.includes("name or service not known") ||
    stderrLower.includes("could not resolve host") ||
    stderrLower.includes("getaddrinfo failed") ||
    stderrLower.includes("dns")
  ) {
    return buildDNSDiagnosis(stderr);
  }

  // 3. SSL/TLS 错误
  if (
    stderrLower.includes("ssl") ||
    stderrLower.includes("certificate") ||
    stderrLower.includes("tls")
  ) {
    return buildSSLDiagnosis(stderr);
  }

  // 4. HTTP 错误
  const httpMatch = stderr.match(
    /(\d{3})\s*(client error|server error|error)/i,
  );
  if (httpMatch) {
    return buildHTTPDiagnosis(parseInt(httpMatch[1]), stderr);
  }

  // 5. 权限错误
  if (
    stderrLower.includes("permission denied") ||
    stderrLower.includes("access denied") ||
    stderrLower.includes("eacces")
  ) {
    return buildPermissionDiagnosis(stderr);
  }

  // 6. 磁盘空间错误
  if (
    stderrLower.includes("no space left") ||
    stderrLower.includes("disk full") ||
    stderrLower.includes("enospc")
  ) {
    return buildDiskFullDiagnosis();
  }

  // 7. 连接被拒绝
  if (
    stderrLower.includes("connection refused") ||
    stderrLower.includes("econnrefused")
  ) {
    return await buildConnectionRefusedDiagnosis(context);
  }

  // 8. 未知错误
  return {
    type: "unknown",
    autoFixable: false,
    suggestedFixes: [],
    requiresUserInput: true,
    userQuestion: `执行失败，错误信息：${
      stderr.slice(0, 200)
    }。你知道如何解决吗？`,
  };
}

async function buildTimeoutDiagnosis(
  context: { tool?: string; url?: string },
): Promise<ErrorDiagnosis> {
  const fixes: Fix[] = [];

  // 1. 检查是否有代理可用
  const proxy = await detectProxyConfig();
  if (proxy) {
    fixes.push({
      id: "apply_existing_proxy",
      description: `应用已配置的代理: ${proxy}`,
      confidence: 0.7,
      action: { type: "set_env", key: "HTTP_PROXY", value: proxy },
    });
  }

  // 2. 尝试镜像源
  if (context.tool === "pip") {
    const mirrors = getMirrors("pypi");
    for (const mirror of mirrors) {
      fixes.push({
        id: `use_mirror_${mirror}`,
        description: `使用镜像源: ${mirror}`,
        confidence: 0.8,
        action: { type: "use_mirror", url: mirror },
      });
    }
  }

  // 3. 增加超时时间
  fixes.push({
    id: "increase_timeout",
    description: "增加超时时间到 5 分钟",
    confidence: 0.3,
    action: { type: "retry_with_timeout", timeoutMs: 300000 },
  });

  return {
    type: "timeout",
    autoFixable: fixes.length > 0,
    suggestedFixes: fixes.sort((a, b) => b.confidence - a.confidence),
    requiresUserInput: fixes.length === 0,
    userQuestion: fixes.length === 0
      ? "网络超时，没有找到可用的代理或镜像。你有可用的代理地址吗？"
      : undefined,
  };
}

function buildDNSDiagnosis(stderr: string): ErrorDiagnosis {
  return {
    type: "dns",
    autoFixable: false,
    suggestedFixes: [
      {
        id: "use_public_dns",
        description: "建议：尝试使用公共 DNS (8.8.8.8 或 114.114.114.114)",
        confidence: 0.5,
        action: {
          type: "custom",
          command: "echo 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf",
        },
      },
    ],
    requiresUserInput: true,
    userQuestion: "DNS 解析失败。请检查网络连接或 DNS 配置。",
  };
}

function buildSSLDiagnosis(stderr: string): ErrorDiagnosis {
  return {
    type: "ssl",
    autoFixable: false,
    suggestedFixes: [],
    requiresUserInput: true,
    userQuestion: "SSL/TLS 证书验证失败。可能是证书过期或系统时间不正确。",
  };
}

function buildHTTPDiagnosis(
  statusCode: number,
  stderr: string,
): ErrorDiagnosis {
  const messages: Record<number, string> = {
    401: "需要认证。请提供 API 密钥或登录凭证。",
    403: "访问被禁止。可能需要特殊权限或 VPN。",
    404: "资源不存在。请检查 URL 是否正确。",
    429: "请求过于频繁。建议等待后重试。",
    500: "服务器内部错误。建议稍后重试。",
    502: "网关错误。服务可能暂时不可用。",
    503: "服务暂时不可用。建议稍后重试。",
  };

  return {
    type: "http_error",
    autoFixable: statusCode >= 500,
    suggestedFixes: statusCode >= 500
      ? [{
        id: "retry_later",
        description: "等待 30 秒后重试",
        confidence: 0.6,
        action: { type: "retry_with_timeout", timeoutMs: 30000 },
      }]
      : [],
    requiresUserInput: statusCode < 500,
    userQuestion: messages[statusCode] || `HTTP 错误 ${statusCode}`,
  };
}

function buildPermissionDiagnosis(stderr: string): ErrorDiagnosis {
  return {
    type: "permission",
    autoFixable: false,
    suggestedFixes: [],
    requiresUserInput: true,
    userQuestion: "权限不足。可能需要使用 sudo 或检查文件权限。",
  };
}

function buildDiskFullDiagnosis(): ErrorDiagnosis {
  return {
    type: "disk_full",
    autoFixable: false,
    suggestedFixes: [],
    requiresUserInput: true,
    userQuestion: "磁盘空间不足。请清理磁盘空间后重试。",
  };
}

async function buildConnectionRefusedDiagnosis(
  context: { tool?: string },
): Promise<ErrorDiagnosis> {
  const fixes: Fix[] = [];

  // 检查代理
  const proxy = await detectProxyConfig();
  if (proxy) {
    fixes.push({
      id: "apply_proxy",
      description: `应用代理: ${proxy}`,
      confidence: 0.6,
      action: { type: "set_env", key: "HTTP_PROXY", value: proxy },
    });
  }

  return {
    type: "timeout", // 连接拒绝通常也是网络问题
    autoFixable: fixes.length > 0,
    suggestedFixes: fixes,
    requiresUserInput: fixes.length === 0,
    userQuestion: "连接被拒绝。服务可能不可用，或需要代理/VPN。",
  };
}
```

### 4. src/utils/diagnostics/retry-policy.ts

```typescript
import type { ErrorDiagnosis, Fix } from "../../types/diagnostics.ts";

/**
 * 重试策略配置
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * 重试上下文
 */
export interface RetryContext {
  attempt: number;
  lastError?: ErrorDiagnosis;
  appliedFixes: string[];
  totalDurationMs: number;
}

/**
 * 创建重试上下文
 */
export function createRetryContext(): RetryContext {
  return {
    attempt: 0,
    appliedFixes: [],
    totalDurationMs: 0,
  };
}

/**
 * 判断是否应该重试
 */
export function shouldRetry(
  context: RetryContext,
  diagnosis: ErrorDiagnosis,
  config: RetryConfig = DEFAULT_CONFIG,
): { shouldRetry: boolean; nextFix?: Fix; delayMs: number } {
  // 已达最大重试次数
  if (context.attempt >= config.maxAttempts) {
    return { shouldRetry: false, delayMs: 0 };
  }

  // 不可自动修复
  if (!diagnosis.autoFixable) {
    return { shouldRetry: false, delayMs: 0 };
  }

  // 找到下一个未尝试的修复
  const nextFix = diagnosis.suggestedFixes.find(
    (fix) => !context.appliedFixes.includes(fix.id),
  );

  if (!nextFix) {
    return { shouldRetry: false, delayMs: 0 };
  }

  // 计算延迟（指数退避）
  const delayMs = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, context.attempt),
    config.maxDelayMs,
  );

  return { shouldRetry: true, nextFix, delayMs };
}

/**
 * 应用修复动作
 */
export async function applyFix(fix: Fix): Promise<void> {
  switch (fix.action.type) {
    case "set_env":
      Deno.env.set(fix.action.key, fix.action.value);
      break;

    case "use_mirror":
      // 镜像源通过环境变量设置（具体实现依赖工具）
      // 这里设置通用的环境变量
      Deno.env.set("MIRROR_URL", fix.action.url);
      break;

    case "retry_with_timeout":
      // 超时设置通过环境变量传递
      Deno.env.set("RETRY_TIMEOUT_MS", String(fix.action.timeoutMs));
      break;

    case "custom":
      // 自定义命令（谨慎执行）
      console.warn(`建议执行: ${fix.action.command}`);
      break;
  }
}

/**
 * 更新重试上下文
 */
export function updateRetryContext(
  context: RetryContext,
  fix: Fix,
  durationMs: number,
): RetryContext {
  return {
    ...context,
    attempt: context.attempt + 1,
    appliedFixes: [...context.appliedFixes, fix.id],
    totalDurationMs: context.totalDurationMs + durationMs,
  };
}

/**
 * 生成重试摘要
 */
export function getRetrySummary(context: RetryContext): string {
  if (context.appliedFixes.length === 0) {
    return "未进行重试";
  }

  return `已尝试 ${context.attempt} 次，应用的修复: ${
    context.appliedFixes.join(", ")
  }`;
}
```

### 5. src/utils/diagnostics/mod.ts

```typescript
export { detectProxyConfig, diagnoseNetwork } from "./network-diagnostics.ts";
export { classifyError } from "./error-classifier.ts";
export { getMirrors, getPipMirrorEnv } from "./config-detector.ts";
export {
  applyFix,
  createRetryContext,
  getRetrySummary,
  type RetryConfig,
  type RetryContext,
  shouldRetry,
  updateRetryContext,
} from "./retry-policy.ts";
```

## 终点状态（验收标准）

### 必须满足

- [ ] `diagnoseNetwork()` 能正确检测网络状态
- [ ] `detectProxyConfig()` 能从环境变量、git 配置、curlrc 中检测代理
- [ ] `classifyError()` 能正确分类常见错误类型
- [ ] `shouldRetry()` 能根据诊断结果决定是否重试
- [ ] `applyFix()` 能正确应用修复动作

### 测试场景

```typescript
// 1. 测试超时错误分类
const diagnosis = await classifyError(
  "ReadTimeoutError: HTTPSConnectionPool - Read timed out",
  { tool: "pip" },
);
assert(diagnosis.type === "timeout");
assert(diagnosis.suggestedFixes.length > 0);

// 2. 测试代理检测
Deno.env.set("HTTP_PROXY", "http://127.0.0.1:7890");
const proxy = await detectProxyConfig();
assert(proxy === "http://127.0.0.1:7890");

// 3. 测试重试策略
const context = createRetryContext();
const { shouldRetry, nextFix } = shouldRetry(context, diagnosis);
assert(shouldRetry === true);
assert(nextFix !== undefined);
```

### 交付物

1. `src/utils/diagnostics/network-diagnostics.ts`
2. `src/utils/diagnostics/config-detector.ts`
3. `src/utils/diagnostics/error-classifier.ts`
4. `src/utils/diagnostics/retry-policy.ts`
5. `src/utils/diagnostics/mod.ts`

## 预估时间

2 天
