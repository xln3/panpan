/**
 * Diagnostic types for automatic error detection and recovery.
 * Used by the diagnostics module to classify errors and suggest fixes.
 */

/**
 * Network connectivity diagnosis result
 */
export interface NetworkDiagnosis {
  /** Whether basic network connectivity is available */
  networkReachable: boolean;
  /** Whether DNS resolution is working */
  dnsWorking: boolean;
  /** Whether a proxy is configured in the system */
  proxyConfigured: boolean;
  /** Detected proxy URL if configured */
  proxyUrl?: string;
  /** List of available mirror URLs for the target service */
  availableMirrors: string[];
  /** Whether SSL/TLS certificates are valid */
  sslValid: boolean;
}

/**
 * Error diagnosis result with suggested fixes
 */
export interface ErrorDiagnosis {
  /** Classified error type */
  type: ErrorType;
  /** Whether this error can be automatically fixed */
  autoFixable: boolean;
  /** List of suggested fixes sorted by confidence */
  suggestedFixes: Fix[];
  /** Whether user input is required to proceed */
  requiresUserInput: boolean;
  /** Question to ask user if input is required */
  userQuestion?: string;
}

/**
 * Classification of common error types
 */
export type ErrorType =
  | "timeout"
  | "dns"
  | "ssl"
  | "http_error"
  | "permission"
  | "disk_full"
  | "dependency_missing"
  | "unknown";

/**
 * A suggested fix for an error
 */
export interface Fix {
  /** Unique identifier for this fix */
  id: string;
  /** Human-readable description of what this fix does */
  description: string;
  /** Confidence score (0-1) that this fix will resolve the issue */
  confidence: number;
  /** The action to take to apply this fix */
  action: FixAction;
}

/**
 * Action types for applying fixes
 */
export type FixAction =
  | { type: "set_env"; key: string; value: string }
  | { type: "use_mirror"; url: string }
  | { type: "retry_with_timeout"; timeoutMs: number }
  | { type: "custom"; command: string };
