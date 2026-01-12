/**
 * Error classification and fix suggestion.
 * Analyzes stderr output to classify errors and suggest fixes.
 */

import type { ErrorDiagnosis, Fix } from "../../types/diagnostics.ts";
import { detectProxyConfig, getMirrors } from "./config-detector.ts";

/** Tool type for context-aware diagnosis */
export type DiagnosticToolType =
  | "pip"
  | "conda"
  | "uv"
  | "pixi"
  | "npm"
  | "git"
  | "curl"
  | "wget";

/** Context for error classification */
export interface DiagnosticContext {
  command?: string;
  tool?: DiagnosticToolType;
  url?: string;
}

/**
 * Classify an error and generate fix suggestions
 */
export async function classifyError(
  stderr: string,
  context: DiagnosticContext = {},
): Promise<ErrorDiagnosis> {
  const stderrLower = stderr.toLowerCase();

  // 1. Timeout errors
  if (isTimeoutError(stderrLower)) {
    return await buildTimeoutDiagnosis(context);
  }

  // 2. DNS errors
  if (isDNSError(stderrLower)) {
    return buildDNSDiagnosis();
  }

  // 3. SSL/TLS errors
  if (isSSLError(stderrLower)) {
    return buildSSLDiagnosis();
  }

  // 4. HTTP errors
  const httpStatus = extractHttpStatus(stderr);
  if (httpStatus) {
    return buildHTTPDiagnosis(httpStatus);
  }

  // 5. Permission errors
  if (isPermissionError(stderrLower)) {
    return buildPermissionDiagnosis();
  }

  // 6. Disk full errors
  if (isDiskFullError(stderrLower)) {
    return buildDiskFullDiagnosis();
  }

  // 7. Connection refused
  if (isConnectionRefusedError(stderrLower)) {
    return await buildConnectionRefusedDiagnosis(context);
  }

  // 8. Unknown error
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

// ============ Error Detection ============

function isTimeoutError(stderr: string): boolean {
  return (
    stderr.includes("timed out") ||
    stderr.includes("timeout") ||
    stderr.includes("read timeout") ||
    stderr.includes("connection timeout") ||
    stderr.includes("readtimedout") ||
    stderr.includes("connecttimeout")
  );
}

function isDNSError(stderr: string): boolean {
  return (
    stderr.includes("name or service not known") ||
    stderr.includes("could not resolve host") ||
    stderr.includes("getaddrinfo failed") ||
    stderr.includes("nodename nor servname provided") ||
    stderr.includes("temporary failure in name resolution")
  );
}

function isSSLError(stderr: string): boolean {
  return (
    stderr.includes("ssl") ||
    stderr.includes("certificate") ||
    stderr.includes("tls") ||
    stderr.includes("handshake")
  );
}

function isPermissionError(stderr: string): boolean {
  return (
    stderr.includes("permission denied") ||
    stderr.includes("access denied") ||
    stderr.includes("eacces") ||
    stderr.includes("eperm")
  );
}

function isDiskFullError(stderr: string): boolean {
  return (
    stderr.includes("no space left") ||
    stderr.includes("disk full") ||
    stderr.includes("enospc")
  );
}

function isConnectionRefusedError(stderr: string): boolean {
  return (
    stderr.includes("connection refused") ||
    stderr.includes("econnrefused") ||
    stderr.includes("connection reset")
  );
}

function extractHttpStatus(stderr: string): number | null {
  // Match patterns like "404", "403 Forbidden", "500 Internal Server Error"
  const patterns = [
    /(\d{3})\s*(client error|server error|error|forbidden|not found|unauthorized)/i,
    /http\s*(\d{3})/i,
    /status[:\s]+(\d{3})/i,
  ];

  for (const pattern of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      const status = parseInt(match[1]);
      if (status >= 400 && status < 600) {
        return status;
      }
    }
  }
  return null;
}

// ============ Diagnosis Builders ============

async function buildTimeoutDiagnosis(
  context: DiagnosticContext,
): Promise<ErrorDiagnosis> {
  const fixes: Fix[] = [];

  // 1. Check if proxy is available
  const proxy = await detectProxyConfig();
  if (proxy) {
    fixes.push({
      id: "apply_existing_proxy",
      description: `应用已配置的代理: ${proxy}`,
      confidence: 0.7,
      action: { type: "set_env", key: "HTTP_PROXY", value: proxy },
    });
  }

  // 2. Suggest mirrors based on tool type
  if (
    context.tool === "pip" || context.tool === "uv" || context.tool === "pixi"
  ) {
    const mirrors = getMirrors("pypi");
    for (const mirror of mirrors) {
      fixes.push({
        id: `use_pypi_mirror_${mirrors.indexOf(mirror)}`,
        description: `使用 PyPI 镜像: ${new URL(mirror).hostname}`,
        confidence: 0.8,
        action: { type: "use_mirror", url: mirror },
      });
    }
  }

  // 3. Increase timeout as last resort
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

function buildDNSDiagnosis(): ErrorDiagnosis {
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

function buildSSLDiagnosis(): ErrorDiagnosis {
  return {
    type: "ssl",
    autoFixable: false,
    suggestedFixes: [],
    requiresUserInput: true,
    userQuestion:
      "SSL/TLS 证书验证失败。可能是证书过期、系统时间不正确、或网络被劫持。",
  };
}

function buildHTTPDiagnosis(statusCode: number): ErrorDiagnosis {
  const messages: Record<number, string> = {
    401: "需要认证。请提供 API 密钥或登录凭证。",
    403: "访问被禁止。可能需要特殊权限或 VPN。",
    404: "资源不存在。请检查 URL 或包名是否正确。",
    429: "请求过于频繁。建议等待后重试。",
    500: "服务器内部错误。建议稍后重试。",
    502: "网关错误。服务可能暂时不可用。",
    503: "服务暂时不可用。建议稍后重试。",
  };

  const isServerError = statusCode >= 500;

  return {
    type: "http_error",
    autoFixable: isServerError,
    suggestedFixes: isServerError
      ? [
        {
          id: "retry_after_delay",
          description: "等待 30 秒后重试",
          confidence: 0.6,
          action: { type: "retry_with_timeout", timeoutMs: 30000 },
        },
      ]
      : [],
    requiresUserInput: !isServerError,
    userQuestion: messages[statusCode] || `HTTP 错误 ${statusCode}`,
  };
}

function buildPermissionDiagnosis(): ErrorDiagnosis {
  return {
    type: "permission",
    autoFixable: false,
    suggestedFixes: [],
    requiresUserInput: true,
    userQuestion: "权限不足。可能需要使用 sudo 或检查文件/目录权限。",
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
  _context: DiagnosticContext,
): Promise<ErrorDiagnosis> {
  const fixes: Fix[] = [];

  // Check if proxy is available
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
    type: "timeout", // Connection refused is often a network issue
    autoFixable: fixes.length > 0,
    suggestedFixes: fixes,
    requiresUserInput: fixes.length === 0,
    userQuestion: "连接被拒绝。服务可能不可用，或需要代理/VPN。",
  };
}
