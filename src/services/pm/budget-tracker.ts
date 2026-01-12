/**
 * Budget Tracker - Manage PM SA resource limits
 * Tracks token usage, time, and attempt counts
 */

import type { PMBudget } from "../../types/pm.ts";

/**
 * Extended budget status with percentages
 */
export interface BudgetStatus extends PMBudget {
  /** Whether budget is exhausted */
  budgetExhausted: boolean;
  /** Token usage percentage (0-100) */
  tokenPercent: number;
  /** Time usage percentage (0-100) */
  timePercent: number;
  /** Attempts usage percentage (0-100) */
  attemptsPercent: number;
}

/**
 * Budget event types
 */
export type BudgetEvent = "warning" | "exceeded";

/**
 * Budget event listener
 */
export type BudgetListener = (event: BudgetEvent, budget: BudgetStatus) => void;

/**
 * Budget configuration
 */
export interface BudgetConfig {
  /** Maximum tokens allowed */
  tokenLimit: number;
  /** Maximum time allowed in milliseconds */
  timeLimit: number;
  /** Maximum retry attempts allowed */
  attemptsLimit: number;
}

/**
 * Tracks PM SA resource usage against limits
 */
export class BudgetTracker {
  private budget: PMBudget;
  private startTime: number;
  private listeners: BudgetListener[] = [];
  private warningThreshold = 0.8; // 80% warning

  constructor(config: BudgetConfig) {
    this.budget = {
      tokenLimit: config.tokenLimit,
      tokenUsed: 0,
      timeLimit: config.timeLimit,
      timeUsed: 0,
      attemptsLimit: config.attemptsLimit,
      attemptsUsed: 0,
    };
    this.startTime = Date.now();
  }

  /**
   * Add token usage
   */
  addTokens(tokens: number): void {
    this.budget.tokenUsed += tokens;
    this.checkBudget();
  }

  /**
   * Increment attempt counter
   */
  addAttempt(): void {
    this.budget.attemptsUsed++;
    this.checkBudget();
  }

  /**
   * Update time usage
   */
  updateTime(): void {
    this.budget.timeUsed = Date.now() - this.startTime;
  }

  /**
   * Check if still within budget
   */
  isWithinBudget(): boolean {
    this.updateTime();
    return (
      this.budget.tokenUsed < this.budget.tokenLimit &&
      this.budget.timeUsed < this.budget.timeLimit &&
      this.budget.attemptsUsed < this.budget.attemptsLimit
    );
  }

  /**
   * Get current budget status
   */
  getStatus(): BudgetStatus {
    this.updateTime();
    return {
      ...this.budget,
      budgetExhausted: !this.isWithinBudget(),
      tokenPercent: Math.min(
        100,
        Math.round((this.budget.tokenUsed / this.budget.tokenLimit) * 100),
      ),
      timePercent: Math.min(
        100,
        Math.round((this.budget.timeUsed / this.budget.timeLimit) * 100),
      ),
      attemptsPercent: Math.min(
        100,
        Math.round(
          (this.budget.attemptsUsed / this.budget.attemptsLimit) * 100,
        ),
      ),
    };
  }

  /**
   * Get the reason for budget exhaustion
   */
  getExhaustionReason(): string | null {
    this.updateTime();

    if (this.budget.tokenUsed >= this.budget.tokenLimit) {
      return "Token 预算耗尽";
    }
    if (this.budget.timeUsed >= this.budget.timeLimit) {
      return "时间预算耗尽";
    }
    if (this.budget.attemptsUsed >= this.budget.attemptsLimit) {
      return "尝试次数耗尽";
    }
    return null;
  }

  /**
   * Get remaining budget
   */
  getRemaining(): {
    tokens: number;
    timeMs: number;
    attempts: number;
  } {
    this.updateTime();
    return {
      tokens: Math.max(0, this.budget.tokenLimit - this.budget.tokenUsed),
      timeMs: Math.max(0, this.budget.timeLimit - this.budget.timeUsed),
      attempts: Math.max(
        0,
        this.budget.attemptsLimit - this.budget.attemptsUsed,
      ),
    };
  }

  /**
   * Add budget event listener
   */
  onBudgetEvent(listener: BudgetListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove budget event listener
   */
  offBudgetEvent(listener: BudgetListener): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  /**
   * Check budget and emit events
   */
  private checkBudget(): void {
    this.updateTime();
    const status = this.getStatus();

    const tokenRatio = this.budget.tokenUsed / this.budget.tokenLimit;
    const timeRatio = this.budget.timeUsed / this.budget.timeLimit;
    const attemptsRatio = this.budget.attemptsUsed / this.budget.attemptsLimit;

    // Check for exceeded
    if (tokenRatio >= 1 || timeRatio >= 1 || attemptsRatio >= 1) {
      this.emit("exceeded", status);
      return;
    }

    // Check for warning
    if (
      tokenRatio >= this.warningThreshold ||
      timeRatio >= this.warningThreshold ||
      attemptsRatio >= this.warningThreshold
    ) {
      this.emit("warning", status);
    }
  }

  /**
   * Emit budget event
   */
  private emit(event: BudgetEvent, status: BudgetStatus): void {
    for (const listener of this.listeners) {
      listener(event, status);
    }
  }

  /**
   * Reset budget counters
   */
  reset(): void {
    this.budget.tokenUsed = 0;
    this.budget.timeUsed = 0;
    this.budget.attemptsUsed = 0;
    this.startTime = Date.now();
  }

  /**
   * Generate budget report
   */
  getReport(): string {
    const status = this.getStatus();
    const remaining = this.getRemaining();

    return `## 预算使用报告

| 类型 | 已用 | 限制 | 剩余 | 百分比 |
|------|------|------|------|--------|
| Token | ${status.tokenUsed} | ${status.tokenLimit} | ${remaining.tokens} | ${status.tokenPercent}% |
| 时间 | ${Math.round(status.timeUsed / 1000)}s | ${
      Math.round(status.timeLimit / 1000)
    }s | ${Math.round(remaining.timeMs / 1000)}s | ${status.timePercent}% |
| 尝试 | ${status.attemptsUsed} | ${status.attemptsLimit} | ${remaining.attempts} | ${status.attemptsPercent}% |

${
      status.budgetExhausted
        ? `**状态**: ⚠️ 预算已耗尽 - ${this.getExhaustionReason()}`
        : "**状态**: ✅ 预算充足"
    }
`;
  }
}
