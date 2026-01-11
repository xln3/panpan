/**
 * Requirements Manager - Track requirement state and Q&A history
 * Used by PM SA to manage requirements lifecycle
 */

import type { Requirement, QA } from "../../types/pm.ts";

/**
 * Manages requirements lifecycle: creation, clarification, and acceptance criteria
 */
export class RequirementsManager {
  private requirements = new Map<string, Requirement>();

  /**
   * Create a new requirement from original text
   */
  create(original: string): Requirement {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const requirement: Requirement = {
      id,
      original,
      clarified: original,
      acceptance: [],
      questions: [],
      status: "draft",
    };

    this.requirements.set(id, requirement);
    return requirement;
  }

  /**
   * Get a requirement by ID
   */
  get(id: string): Requirement | undefined {
    return this.requirements.get(id);
  }

  /**
   * Add a question-answer pair to a requirement
   */
  addQA(id: string, question: string, answer: string): void {
    const req = this.requirements.get(id);
    if (!req) return;

    req.questions.push({
      question,
      answer,
      timestamp: Date.now(),
    });
  }

  /**
   * Update the clarified version of a requirement
   */
  updateClarified(id: string, clarified: string): void {
    const req = this.requirements.get(id);
    if (req) {
      req.clarified = clarified;
      req.status = "clarified";
    }
  }

  /**
   * Set acceptance criteria for a requirement
   */
  setAcceptance(id: string, criteria: string[]): void {
    const req = this.requirements.get(id);
    if (req) {
      req.acceptance = criteria;
    }
  }

  /**
   * Update requirement status
   */
  updateStatus(id: string, status: Requirement["status"]): void {
    const req = this.requirements.get(id);
    if (req) {
      req.status = status;
    }
  }

  /**
   * List all requirements
   */
  list(): Requirement[] {
    return Array.from(this.requirements.values());
  }

  /**
   * Delete a requirement
   */
  delete(id: string): boolean {
    return this.requirements.delete(id);
  }

  /**
   * Clear all requirements (useful for testing)
   */
  clear(): void {
    this.requirements.clear();
  }

  /**
   * Get requirements by status
   */
  getByStatus(status: Requirement["status"]): Requirement[] {
    return this.list().filter((req) => req.status === status);
  }
}

// Singleton instance for global access
export const requirementsManager = new RequirementsManager();
