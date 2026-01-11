/**
 * Log summarizer - generates human-readable summaries and timelines from log entries.
 */

import type { LogEntry } from "../../types/logger.ts";

/**
 * Statistics from log analysis
 */
export interface LogStats {
  totalOperations: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
  toolCalls: Map<string, number>;
  llmCalls: number;
  saCalls: number;
}

/**
 * Analyze log entries and compute statistics
 */
export function computeStats(entries: LogEntry[]): LogStats {
  const stats: LogStats = {
    totalOperations: 0,
    successCount: 0,
    failureCount: 0,
    totalDurationMs: 0,
    toolCalls: new Map(),
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

    // Count tool calls by name
    if (entry.type === "tool_call" || entry.type === "tool_result") {
      const data = entry.data as Record<string, unknown>;
      const toolName = data?.toolName as string;
      if (toolName) {
        stats.toolCalls.set(toolName, (stats.toolCalls.get(toolName) || 0) + 1);
      }
    }

    // Count LLM calls (count response as one call)
    if (entry.type === "llm_response") {
      stats.llmCalls++;
    }

    // Count subagent invocations
    if (entry.type === "sa_invoke") {
      stats.saCalls++;
    }
  }

  return stats;
}

/**
 * Generate a human-readable summary from log entries
 */
export function generateSummary(entries: LogEntry[]): string {
  const stats = computeStats(entries);

  const lines: string[] = [
    "## 操作摘要",
    "",
    `- 总操作数: ${stats.totalOperations}`,
    `- 成功: ${stats.successCount}`,
    `- 失败: ${stats.failureCount}`,
    `- 总耗时: ${(stats.totalDurationMs / 1000).toFixed(2)}s`,
    "",
  ];

  // Tool call statistics
  if (stats.toolCalls.size > 0) {
    lines.push("### 工具调用统计");
    for (const [tool, count] of stats.toolCalls) {
      lines.push(`- ${tool}: ${count} 次`);
    }
    lines.push("");
  }

  // LLM and SA statistics
  lines.push(`### LLM 调用: ${stats.llmCalls} 轮`);
  if (stats.saCalls > 0) {
    lines.push(`### Subagent 调用: ${stats.saCalls} 次`);
  }

  return lines.join("\n");
}

/**
 * Generate a timeline view of operations
 */
export function generateTimeline(entries: LogEntry[]): string {
  const lines: string[] = ["## 操作时间线", ""];

  // Sort by timestamp
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);

  for (const entry of sorted) {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const status = entry.success ? "✓" : "✗";
    const duration = entry.duration ? ` (${entry.duration}ms)` : "";

    let description: string;
    const data = entry.data as Record<string, unknown>;

    switch (entry.type) {
      case "tool_call":
        description = `Tool start: ${data?.toolName}`;
        break;
      case "tool_result":
        description = `Tool: ${data?.toolName}`;
        break;
      case "llm_request":
        description = "LLM 请求";
        break;
      case "llm_response":
        description = "LLM 响应";
        break;
      case "sa_invoke":
        description = `Subagent: ${data?.agentType}`;
        break;
      case "sa_result":
        description = `Subagent 完成: ${data?.agentType}`;
        break;
      case "abort":
        description = "中断";
        break;
      case "error":
        description = "错误";
        break;
      default:
        description = entry.type;
    }

    lines.push(`${time} ${status} ${description}${duration}`);

    // Show error details for failures
    if (!entry.success && entry.error) {
      lines.push(`       ↳ Error: ${entry.error}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a compact one-line summary
 */
export function generateOneLiner(entries: LogEntry[]): string {
  const stats = computeStats(entries);
  const successRate = stats.totalOperations > 0
    ? Math.round((stats.successCount / stats.totalOperations) * 100)
    : 100;

  return `${stats.totalOperations} ops | ${successRate}% success | ${stats.llmCalls} LLM calls | ${(stats.totalDurationMs / 1000).toFixed(1)}s`;
}
