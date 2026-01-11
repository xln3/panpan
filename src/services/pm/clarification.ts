/**
 * Clarification Helper - Detect vague terms and generate clarifying questions
 * Core component for PM SA's requirement clarification workflow
 */

import type { QA } from "../../types/pm.ts";

/**
 * Result of analyzing a requirement for clarity
 */
export interface ClarificationResult {
  /** Whether the requirement is clear enough to proceed */
  isClear: boolean;
  /** List of issues found */
  issues: ClarificationIssue[];
  /** Generated questions to ask user */
  suggestedQuestions: string[];
}

/**
 * An issue found during requirement analysis
 */
export interface ClarificationIssue {
  /** Type of issue */
  type: "vague_term" | "missing_info" | "ambiguity";
  /** The problematic term or missing concept */
  term: string;
  /** Question to ask to resolve this issue */
  question: string;
  /** How critical is this issue */
  severity: "high" | "medium" | "low";
}

/**
 * A vague term and its associated clarifying question
 */
interface VagueTerm {
  term: string;
  question: string;
}

/**
 * Helps analyze requirements and generate clarifying questions
 */
export class ClarificationHelper {
  // Vague terms that need specific definitions
  private vagueTerms: VagueTerm[] = [
    { term: "快", question: "请具体说明 '快' 的标准是什么？（例如：响应时间 < 100ms）" },
    { term: "好", question: "请具体说明 '好' 的标准是什么？" },
    { term: "优化", question: "请说明优化的目标指标是什么？（例如：性能、内存、代码质量）" },
    { term: "改进", question: "请说明具体需要改进哪些方面？" },
    { term: "简单", question: "请说明 '简单' 是指代码简洁还是使用简单？" },
    { term: "安全", question: "请说明需要防范哪些安全威胁？" },
    { term: "稳定", question: "请说明 '稳定' 的具体要求？（例如：99.9% 可用性）" },
    { term: "高效", question: "请说明 '高效' 的衡量标准？" },
    { term: "灵活", question: "请说明需要支持哪些变化场景？" },
    { term: "可扩展", question: "请说明预期的扩展规模和方向？" },
    { term: "用户友好", question: "请描述目标用户群体和他们的技术水平？" },
    { term: "尽快", question: "请给出具体的时间期望（例如：今天内、本周内）" },
    { term: "大量", question: "请给出具体的数量级（例如：100条、10万条）" },
    { term: "频繁", question: "请给出具体的频率（例如：每秒10次、每天100次）" },
  ];

  /**
   * Analyze requirement text to find issues that need clarification
   */
  analyzeRequirement(text: string): ClarificationResult {
    const issues: ClarificationIssue[] = [];

    // Detect vague terms
    for (const { term, question } of this.vagueTerms) {
      if (text.includes(term)) {
        issues.push({
          type: "vague_term",
          term,
          question,
          severity: "high",
        });
      }
    }

    // Detect missing information
    if (!text.includes("测试") && !text.includes("test")) {
      issues.push({
        type: "missing_info",
        term: "测试要求",
        question: "是否需要编写测试？测试覆盖率要求是多少？",
        severity: "medium",
      });
    }

    if (
      !text.includes("错误") && !text.includes("error") &&
      !text.includes("异常") && !text.includes("exception")
    ) {
      issues.push({
        type: "missing_info",
        term: "错误处理",
        question: "错误情况应该如何处理？",
        severity: "medium",
      });
    }

    // Detect ambiguity in scope
    if (text.includes("等") || text.includes("之类")) {
      issues.push({
        type: "ambiguity",
        term: "范围模糊",
        question: "请列出完整的需求范围，避免使用 '等' 或 '之类' 这样的模糊词",
        severity: "medium",
      });
    }

    return {
      isClear: issues.filter((i) => i.severity === "high").length === 0,
      issues,
      suggestedQuestions: issues.map((i) => i.question),
    };
  }

  /**
   * Extract acceptance criteria from original requirement and Q&A history
   */
  extractAcceptanceCriteria(original: string, qas: QA[]): string[] {
    const criteria: string[] = [];

    // Extract from original requirement
    if (original.includes("能够") || original.includes("可以")) {
      criteria.push(`功能验证: ${original}`);
    }

    // Extract specific criteria from Q&A answers
    for (const qa of qas) {
      // Answers containing numbers are usually specific criteria
      if (/\d+/.test(qa.answer)) {
        const cleanQuestion = qa.question.replace(/[？?]$/, "");
        criteria.push(`${cleanQuestion}: ${qa.answer}`);
      }
    }

    // Default criteria if none extracted
    if (criteria.length === 0) {
      criteria.push("代码编译/运行无错误");
      criteria.push("符合原始需求描述");
    }

    return criteria;
  }

  /**
   * Check if a specific vague term exists in text
   */
  hasVagueTerm(text: string, term: string): boolean {
    return text.includes(term);
  }

  /**
   * Get question for a specific vague term
   */
  getQuestionForTerm(term: string): string | undefined {
    const found = this.vagueTerms.find((v) => v.term === term);
    return found?.question;
  }

  /**
   * Add a custom vague term and question
   */
  addVagueTerm(term: string, question: string): void {
    this.vagueTerms.push({ term, question });
  }

  /**
   * Get all registered vague terms
   */
  getVagueTerms(): VagueTerm[] {
    return [...this.vagueTerms];
  }
}

// Singleton instance for global access
export const clarificationHelper = new ClarificationHelper();
