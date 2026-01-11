/**
 * PM (Project Manager) types for requirement clarification and verification.
 * Used by PMSA to track requirements, generate test plans, and verify completion.
 */

/**
 * A requirement definition with clarifications
 */
export interface Requirement {
  /** Unique identifier for this requirement */
  id: string;
  /** Original requirement text as provided by user */
  original: string;
  /** Clarified requirement after Q&A */
  clarified: string;
  /** List of acceptance criteria */
  acceptance: string[];
  /** Questions asked and answers received */
  questions: QA[];
  /** Current status of this requirement */
  status: "draft" | "clarified" | "verified" | "rejected";
}

/**
 * A question-answer pair from requirement clarification
 */
export interface QA {
  /** The question asked */
  question: string;
  /** The answer provided */
  answer: string;
  /** Unix timestamp when answer was received */
  timestamp: number;
}

/**
 * A test plan for verifying requirements
 */
export interface TestPlan {
  /** IDs of requirements covered by this plan */
  requirements: string[];
  /** Test cases in this plan */
  tests: TestCase[];
  /** Unix timestamp when plan was generated */
  generatedAt: number;
}

/**
 * A single test case
 */
export interface TestCase {
  /** Unique identifier for this test */
  id: string;
  /** ID of the requirement this test verifies */
  requirementId: string;
  /** Whether this test existed or was generated */
  type: "existing" | "generated";
  /** Path to existing test file */
  path?: string;
  /** Template for generated test */
  template?: string;
  /** Current status of this test */
  status: "pending" | "passed" | "failed";
  /** Unix timestamp of last test run */
  lastRun?: number;
  /** Error message if test failed */
  error?: string;
}

/**
 * Budget tracking for PM operations
 */
export interface PMBudget {
  /** Maximum tokens allowed */
  tokenLimit: number;
  /** Tokens used so far */
  tokenUsed: number;
  /** Maximum time allowed in milliseconds */
  timeLimit: number;
  /** Time used so far in milliseconds */
  timeUsed: number;
  /** Maximum retry attempts allowed */
  attemptsLimit: number;
  /** Attempts used so far */
  attemptsUsed: number;
}

/**
 * An alternative approach that can be tried if primary fails
 */
export interface AlternativePlan {
  /** Unique identifier for this plan */
  id: string;
  /** Description of what this plan does differently */
  description: string;
  /** Confidence score (0-1) that this plan will work */
  confidence: number;
  /** Unix timestamp when this plan was tried */
  triedAt?: number;
  /** Result of trying this plan */
  result?: "success" | "failed";
  /** Reason for failure if applicable */
  failureReason?: string;
}

// ============ Tool Input Types ============

/**
 * Input for PMClarify tool - clarifies requirements
 */
export interface PMClarifyInput {
  /** Raw requirements text to clarify */
  requirements: string;
  /** Whether to automatically generate and ask questions */
  autoAsk?: boolean;
}

/**
 * Input for PMTestPlan tool - generates test plan
 */
export interface PMTestPlanInput {
  /** IDs of requirements to create tests for */
  requirementIds: string[];
  /** Whether to search for existing tests */
  searchExisting?: boolean;
  /** Whether to generate new tests */
  generateNew?: boolean;
}

/**
 * Input for PMVerify tool - runs verification
 */
export interface PMVerifyInput {
  /** Specific test IDs to run (all if not specified) */
  testIds?: string[];
  /** Whether to stop on first failure */
  failFast?: boolean;
  /** Maximum retries for flaky tests */
  maxRetries?: number;
}

/**
 * Input for PMStatus tool - gets current status
 */
export interface PMStatusInput {
  /** Whether to include alternative plans in status */
  includeAlternatives?: boolean;
}
