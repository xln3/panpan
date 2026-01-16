/**
 * Pending request manager for email choice responses
 *
 * Manages the lifecycle of choice requests:
 * - Creates unique tokens for each request
 * - Tracks expiration times
 * - Resolves responses when user clicks an option
 * - Cleans up expired requests
 */

import type { ChoiceOption, PendingRequest } from "../../types/email.ts";

/**
 * Manager for pending email choice requests
 */
export class PendingRequestManager {
  private requests = new Map<string, PendingRequest>();
  private resolvers = new Map<string, (optionId: string | null) => void>();
  private cleanupInterval: number | undefined;

  /**
   * Start the cleanup interval (called when service is initialized)
   */
  start(): void {
    if (this.cleanupInterval === undefined) {
      this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    }
  }

  /**
   * Create a new pending request and return its token
   */
  create(options: ChoiceOption[], timeoutMinutes: number): string {
    const id = crypto.randomUUID();
    const now = Date.now();

    const request: PendingRequest = {
      id,
      options,
      createdAt: now,
      expiresAt: now + timeoutMinutes * 60 * 1000,
      resolved: false,
    };

    this.requests.set(id, request);
    return id;
  }

  /**
   * Resolve a pending request with the selected option
   * Returns true if successful, false if invalid/expired/already resolved
   */
  resolve(token: string, optionId: string): boolean {
    const request = this.requests.get(token);

    if (!request) {
      return false;
    }

    if (request.resolved) {
      return false;
    }

    if (Date.now() > request.expiresAt) {
      // Expired - notify waiters
      const resolver = this.resolvers.get(token);
      if (resolver) {
        resolver(null);
        this.resolvers.delete(token);
      }
      return false;
    }

    // Validate option ID exists
    const validOption = request.options.find((opt) => opt.id === optionId);
    if (!validOption) {
      return false;
    }

    // Mark as resolved
    request.resolved = true;
    request.selectedOptionId = optionId;

    // Notify waiter
    const resolver = this.resolvers.get(token);
    if (resolver) {
      resolver(optionId);
      this.resolvers.delete(token);
    }

    return true;
  }

  /**
   * Wait for a response or timeout
   * Returns the selected option ID, or null if timed out
   */
  waitForResponse(token: string): Promise<string | null> {
    const request = this.requests.get(token);

    if (!request) {
      return Promise.resolve(null);
    }

    // Already resolved
    if (request.resolved && request.selectedOptionId) {
      return Promise.resolve(request.selectedOptionId);
    }

    // Already expired
    const remainingMs = request.expiresAt - Date.now();
    if (remainingMs <= 0) {
      return Promise.resolve(null);
    }

    // Create promise that resolves on response or timeout
    return new Promise((resolve) => {
      // Store resolver for when response comes
      this.resolvers.set(token, resolve);

      // Set timeout
      setTimeout(() => {
        if (this.resolvers.has(token)) {
          this.resolvers.delete(token);
          resolve(null);
        }
      }, remainingMs);
    });
  }

  /**
   * Get a pending request by token
   */
  get(token: string): PendingRequest | undefined {
    return this.requests.get(token);
  }

  /**
   * Check if a token exists and is valid
   */
  isValid(token: string): boolean {
    const request = this.requests.get(token);
    if (!request) return false;
    if (request.resolved) return false;
    if (Date.now() > request.expiresAt) return false;
    return true;
  }

  /**
   * Clean up expired requests
   */
  cleanup(): void {
    const now = Date.now();
    for (const [token, request] of this.requests) {
      if (now > request.expiresAt) {
        // Notify any waiting resolver
        const resolver = this.resolvers.get(token);
        if (resolver) {
          resolver(null);
          this.resolvers.delete(token);
        }
        this.requests.delete(token);
      }
    }
  }

  /**
   * Get current request count (for diagnostics)
   */
  get size(): number {
    return this.requests.size;
  }

  /**
   * Shutdown the manager
   */
  shutdown(): void {
    if (this.cleanupInterval !== undefined) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Resolve all pending waiters with null
    for (const [token, resolver] of this.resolvers) {
      resolver(null);
      this.resolvers.delete(token);
    }

    this.requests.clear();
  }
}

// Singleton instance
export const pendingRequestManager = new PendingRequestManager();
