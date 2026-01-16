/**
 * Fibonacci function with intentional bugs for PM acceptance loop testing
 *
 * This implementation has 3 bugs that need to be fixed:
 * 1. Base case for n=0 returns 1 instead of 0
 * 2. Base case for n=1 returns 0 instead of 1
 * 3. Recursive case has wrong formula (n-1 + n-2 instead of fib(n-1) + fib(n-2))
 *
 * PM should discover and fix these through iterative testing.
 */

export function fibonacci(n: number): number {
  // Bug 1: Wrong base case for n=0 (should return 0, not 1)
  if (n === 0) return 1;

  // Bug 2: Wrong base case for n=1 (should return 1, not 0)
  if (n === 1) return 0;

  // Bug 3: Wrong recursive formula (missing function calls)
  // Should be: fibonacci(n - 1) + fibonacci(n - 2)
  return (n - 1) + (n - 2);
}

/**
 * Calculate sum of first n Fibonacci numbers
 * Depends on fibonacci() being correct
 */
export function fibonacciSum(n: number): number {
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    sum += fibonacci(i);
  }
  return sum;
}
