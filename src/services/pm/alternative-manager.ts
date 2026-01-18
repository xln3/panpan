/**
 * Alternative Manager - Track and execute alternative approaches when blocked
 *
 * When primary approach fails (network issues, missing resources, etc.),
 * PM SA uses this to systematically try alternatives instead of waiting.
 */

import type { AlternativePlan } from "../../types/pm.ts";

/**
 * Predefined alternatives for common blockers
 */
export const COMMON_ALTERNATIVES: Record<string, Omit<AlternativePlan, "id">[]> =
  {
    // Network/download blockers
    huggingface_blocked: [
      {
        description: "使用 HuggingFace 镜像站 (hf-mirror.com)",
        confidence: 0.8,
      },
      {
        description: "使用 ModelScope 替代下载",
        confidence: 0.6,
      },
      {
        description: "本地下载后通过 SCP 传输",
        confidence: 0.9,
      },
      {
        description: "检查服务器是否有预装模型缓存",
        confidence: 0.4,
      },
    ],
    google_drive_blocked: [
      {
        description: "使用 gdown 工具尝试下载",
        confidence: 0.5,
      },
      {
        description: "本地下载后通过 SCP 传输",
        confidence: 0.9,
      },
      {
        description: "联系作者获取替代下载链接",
        confidence: 0.3,
      },
    ],
    github_blocked: [
      {
        description: "使用 GitHub 镜像站 (gitclone.com, ghproxy.com)",
        confidence: 0.7,
      },
      {
        description: "本地克隆后通过 SCP 传输",
        confidence: 0.9,
      },
      {
        description: "检查并清除代理配置 (unset http_proxy)",
        confidence: 0.6,
      },
    ],
    pip_install_failed: [
      {
        description: "使用国内镜像源 (-i https://pypi.tuna.tsinghua.edu.cn/simple)",
        confidence: 0.8,
      },
      {
        description: "分批安装依赖，隔离问题包",
        confidence: 0.7,
      },
      {
        description: "使用 conda 替代 pip 安装",
        confidence: 0.5,
      },
      {
        description: "从源码编译安装问题包",
        confidence: 0.4,
      },
    ],
    conda_failed: [
      {
        description: "使用 mamba 替代 conda (更快更可靠)",
        confidence: 0.7,
      },
      {
        description: "使用 pip 替代 conda 安装",
        confidence: 0.6,
      },
      {
        description: "清理 conda 缓存并重试",
        confidence: 0.5,
      },
    ],
    disk_full: [
      {
        description: "清理临时文件和缓存",
        confidence: 0.7,
      },
      {
        description: "移动数据到其他挂载点 (/autodl-tmp, /data)",
        confidence: 0.8,
      },
      {
        description: "压缩不常用文件",
        confidence: 0.5,
      },
    ],
    permission_denied: [
      {
        description: "使用用户目录替代系统目录",
        confidence: 0.8,
      },
      {
        description: "检查文件所有权并修复",
        confidence: 0.6,
      },
      {
        description: "使用 --user 标志安装",
        confidence: 0.7,
      },
    ],
  };

/**
 * Manages alternative approaches for blocked tasks
 */
export class AlternativeManager {
  private plans = new Map<string, AlternativePlan>();
  private blockerType: string | null = null;

  /**
   * Detect blocker type from error message
   */
  detectBlockerType(errorMessage: string): string | null {
    const lower = errorMessage.toLowerCase();

    if (
      lower.includes("huggingface") ||
      lower.includes("hf.co") ||
      lower.includes("huggingface.co")
    ) {
      return "huggingface_blocked";
    }
    if (
      lower.includes("drive.google") ||
      lower.includes("google drive") ||
      lower.includes("gdown")
    ) {
      return "google_drive_blocked";
    }
    if (
      lower.includes("github.com") ||
      (lower.includes("git clone") && lower.includes("fail"))
    ) {
      return "github_blocked";
    }
    if (lower.includes("pip install") && lower.includes("error")) {
      return "pip_install_failed";
    }
    if (
      lower.includes("conda") &&
      (lower.includes("fail") ||
        lower.includes("error") ||
        lower.includes("notfound") ||
        lower.includes("not found"))
    ) {
      return "conda_failed";
    }
    if (
      lower.includes("no space left") ||
      lower.includes("disk full") ||
      lower.includes("enospc")
    ) {
      return "disk_full";
    }
    if (
      lower.includes("permission denied") ||
      lower.includes("eacces") ||
      lower.includes("operation not permitted")
    ) {
      return "permission_denied";
    }
    if (
      lower.includes("network") &&
      (lower.includes("unreachable") || lower.includes("timeout"))
    ) {
      return "huggingface_blocked"; // Generic network issue, try HF alternatives
    }

    return null;
  }

  /**
   * Initialize alternatives for a detected blocker
   */
  initForBlocker(blockerType: string): AlternativePlan[] {
    this.blockerType = blockerType;
    this.plans.clear();

    const templates = COMMON_ALTERNATIVES[blockerType];
    if (!templates) {
      return [];
    }

    const plans: AlternativePlan[] = templates.map((template, index) => ({
      id: `alt-${blockerType}-${index}`,
      ...template,
    }));

    for (const plan of plans) {
      this.plans.set(plan.id, plan);
    }

    // Sort by confidence descending
    return plans.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Add a custom alternative plan
   */
  addPlan(description: string, confidence: number): AlternativePlan {
    const id = `alt-custom-${Date.now()}`;
    const plan: AlternativePlan = {
      id,
      description,
      confidence,
    };
    this.plans.set(id, plan);
    return plan;
  }

  /**
   * Get the next untried alternative (highest confidence first)
   */
  getNextUntried(): AlternativePlan | null {
    const untried = Array.from(this.plans.values())
      .filter((p) => !p.triedAt)
      .sort((a, b) => b.confidence - a.confidence);

    return untried[0] || null;
  }

  /**
   * Mark a plan as tried with result
   */
  markTried(
    planId: string,
    result: "success" | "failed",
    failureReason?: string,
  ): void {
    const plan = this.plans.get(planId);
    if (plan) {
      plan.triedAt = Date.now();
      plan.result = result;
      plan.failureReason = failureReason;
    }
  }

  /**
   * Get all plans
   */
  listPlans(): AlternativePlan[] {
    return Array.from(this.plans.values());
  }

  /**
   * Get tried plans
   */
  getTriedPlans(): AlternativePlan[] {
    return this.listPlans().filter((p) => p.triedAt);
  }

  /**
   * Get successful plan if any
   */
  getSuccessfulPlan(): AlternativePlan | null {
    return this.listPlans().find((p) => p.result === "success") || null;
  }

  /**
   * Check if all alternatives have been exhausted
   */
  isExhausted(): boolean {
    const all = this.listPlans();
    if (all.length === 0) return true;
    return all.every((p) => p.triedAt !== undefined);
  }

  /**
   * Generate a report of all attempts
   */
  generateReport(): string {
    const tried = this.getTriedPlans();
    const untried = this.listPlans().filter((p) => !p.triedAt);
    const successful = this.getSuccessfulPlan();

    let report = `## 备选方案执行报告\n\n`;
    report += `阻断类型: ${this.blockerType || "未知"}\n\n`;

    if (successful) {
      report += `✅ **成功方案**: ${successful.description}\n\n`;
    }

    if (tried.length > 0) {
      report += `### 已尝试 (${tried.length})\n`;
      for (const plan of tried) {
        const status = plan.result === "success" ? "✅" : "❌";
        report += `${status} ${plan.description}`;
        if (plan.failureReason) {
          report += ` - 失败原因: ${plan.failureReason}`;
        }
        report += "\n";
      }
      report += "\n";
    }

    if (untried.length > 0 && !successful) {
      report += `### 未尝试 (${untried.length})\n`;
      for (const plan of untried) {
        report += `⏳ ${plan.description} (置信度: ${Math.round(plan.confidence * 100)}%)\n`;
      }
    }

    if (this.isExhausted() && !successful) {
      report += `\n⚠️ **所有备选方案已耗尽，均未成功**\n`;
    }

    return report;
  }

  /**
   * Clear all plans
   */
  clear(): void {
    this.plans.clear();
    this.blockerType = null;
  }
}

// Singleton instance
export const alternativeManager = new AlternativeManager();
