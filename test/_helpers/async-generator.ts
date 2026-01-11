/**
 * Helper utilities for testing async generators
 */

/**
 * Collect all values from an async generator into an array
 */
export async function collectGenerator<T>(
  gen: AsyncGenerator<T>,
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

/**
 * Collect values from an async generator with a timeout
 */
export async function collectGeneratorWithTimeout<T>(
  gen: AsyncGenerator<T>,
  timeoutMs: number,
): Promise<{ results: T[]; timedOut: boolean }> {
  const results: T[] = [];
  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), timeoutMs)
  );

  try {
    while (true) {
      const result = await Promise.race([gen.next(), timeoutPromise]);
      if (result === "timeout") {
        return { results, timedOut: true };
      }
      if (result.done) {
        break;
      }
      results.push(result.value);
    }
  } catch {
    // Generator threw an error
  }

  return { results, timedOut: false };
}

/**
 * Take first N values from an async generator
 */
export async function takeFromGenerator<T>(
  gen: AsyncGenerator<T>,
  n: number,
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
    if (results.length >= n) {
      break;
    }
  }
  return results;
}
