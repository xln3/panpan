/**
 * Failure analyzer - identifies failure points and suggests fixes.
 */

import type { FailurePoint, LogEntry } from "../../types/logger.ts";

/**
 * Analyze log entries to identify failure points
 */
export function analyzeFailures(entries: LogEntry[]): FailurePoint[] {
  const failures: FailurePoint[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.success) continue;

    // Get previous steps as context (up to 5)
    const previousSteps: string[] = [];
    for (let j = Math.max(0, i - 5); j < i; j++) {
      const prev = entries[j];
      const data = prev.data as Record<string, unknown>;
      const summary = data?.toolName
        ? `${prev.type}: ${data.toolName}`
        : prev.type;
      previousSteps.push(summary);
    }

    // Collect tool state at time of failure
    const toolState: Record<string, unknown> = {};
    for (let j = 0; j <= i; j++) {
      const prev = entries[j];
      if (prev.type === "tool_result" && prev.success) {
        const data = prev.data as Record<string, unknown>;
        const toolName = data?.toolName as string;
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
 * Suggest fixes based on failure type and error message
 */
function suggestFixes(entry: LogEntry): string[] {
  const fixes: string[] = [];
  const error = entry.error?.toLowerCase() || "";
  const data = entry.data as Record<string, unknown>;

  // Network-related errors
  if (
    error.includes("timeout") ||
    error.includes("network") ||
    error.includes("connection") ||
    error.includes("timed out")
  ) {
    fixes.push("尝试使用代理或 VPN");
    fixes.push("检查网络连接");
    fixes.push("使用镜像源");
  }

  // Permission errors
  if (
    error.includes("permission") || error.includes("access denied") ||
    error.includes("eacces")
  ) {
    fixes.push("检查文件/目录权限");
    fixes.push("尝试使用 sudo");
  }

  // Not found errors
  if (
    error.includes("not found") || error.includes("no such file") ||
    error.includes("enoent")
  ) {
    fixes.push("检查路径是否正确");
    fixes.push("确认依赖已安装");
  }

  // Disk space errors
  if (
    error.includes("disk") || error.includes("space") ||
    error.includes("enospc")
  ) {
    fixes.push("清理磁盘空间");
    fixes.push("检查磁盘配额");
  }

  // DNS errors
  if (error.includes("dns") || error.includes("resolve")) {
    fixes.push("检查 DNS 设置");
    fixes.push("尝试使用 8.8.8.8 或 114.114.114.114");
  }

  // SSL/TLS errors
  if (
    error.includes("ssl") || error.includes("certificate") ||
    error.includes("tls")
  ) {
    fixes.push("检查系统时间是否正确");
    fixes.push("更新 CA 证书");
  }

  // Tool-specific suggestions
  const toolName = data?.toolName as string;
  if (toolName === "Pip" || toolName === "pip") {
    fixes.push(
      "尝试使用清华镜像源: pip install -i https://pypi.tuna.tsinghua.edu.cn/simple",
    );
    fixes.push("检查 Python 环境是否正确激活");
  }

  if (toolName === "Conda" || toolName === "conda") {
    fixes.push("尝试使用 conda-forge 镜像");
    fixes.push("检查 Conda 环境是否正确激活");
  }

  // Default suggestion
  if (fixes.length === 0) {
    fixes.push("检查错误信息，查找相关文档");
  }

  return fixes;
}

/**
 * Find patterns in failures to suggest alternative approaches
 */
export function findAlternativeRoutes(
  failures: FailurePoint[],
  _allEntries: LogEntry[],
): string[] {
  const alternatives: string[] = [];

  // Analyze failure patterns
  const failureTypes = new Map<string, number>();
  for (const failure of failures) {
    const errorPrefix = failure.error.split(":")[0].toLowerCase();
    const key = `${failure.type}:${errorPrefix}`;
    failureTypes.set(key, (failureTypes.get(key) || 0) + 1);
  }

  // Generate suggestions based on patterns
  for (const [type, count] of failureTypes) {
    const typeLower = type.toLowerCase();

    if (
      typeLower.includes("network") || typeLower.includes("timeout") ||
      typeLower.includes("connection")
    ) {
      alternatives.push("网络问题频繁，建议先解决网络配置（代理/VPN/镜像）");
    }

    if (typeLower.includes("permission") || typeLower.includes("access")) {
      alternatives.push("权限问题，考虑在用户目录执行或检查权限设置");
    }

    if (typeLower.includes("not found") || typeLower.includes("enoent")) {
      alternatives.push("路径/依赖问题，请确认目标文件存在且依赖已安装");
    }

    if (count >= 3) {
      alternatives.push(
        `"${type.split(":")[0]}" 失败 ${count} 次，可能需要换一种方法`,
      );
    }
  }

  // Deduplicate
  return [...new Set(alternatives)];
}

/**
 * Get a failure summary suitable for display
 */
export function getFailureSummary(failures: FailurePoint[]): string {
  if (failures.length === 0) {
    return "所有操作成功完成";
  }

  const lines: string[] = [
    `## 失败分析 (${failures.length} 个失败点)`,
    "",
  ];

  for (const failure of failures) {
    lines.push(`### ${failure.type}`);
    lines.push(`- 错误: ${failure.error}`);

    if (failure.suggestedFixes.length > 0) {
      lines.push("- 建议修复:");
      for (const fix of failure.suggestedFixes) {
        lines.push(`  - ${fix}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}
