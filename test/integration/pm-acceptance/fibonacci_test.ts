/**
 * Tests for fibonacci function
 * These tests will fail until all bugs in fibonacci.ts are fixed
 */

import { assertEquals } from "@std/assert";
import { fibonacci, fibonacciSum } from "./fibonacci.ts";

Deno.test("fibonacci - base case n=0 returns 0", () => {
  // Bug 1 will cause this to fail (returns 1 instead of 0)
  assertEquals(fibonacci(0), 0, "fib(0) should be 0");
});

Deno.test("fibonacci - base case n=1 returns 1", () => {
  // Bug 2 will cause this to fail (returns 0 instead of 1)
  assertEquals(fibonacci(1), 1, "fib(1) should be 1");
});

Deno.test("fibonacci - n=2 returns 1", () => {
  // fib(2) = fib(1) + fib(0) = 1 + 0 = 1
  assertEquals(fibonacci(2), 1, "fib(2) should be 1");
});

Deno.test("fibonacci - n=5 returns 5", () => {
  // fib(5) = 0, 1, 1, 2, 3, 5
  assertEquals(fibonacci(5), 5, "fib(5) should be 5");
});

Deno.test("fibonacci - n=10 returns 55", () => {
  // fib(10) = 55
  assertEquals(fibonacci(10), 55, "fib(10) should be 55");
});

Deno.test("fibonacciSum - sum of first 5 Fibonacci numbers", () => {
  // sum(fib(0..5)) = 0 + 1 + 1 + 2 + 3 + 5 = 12
  assertEquals(fibonacciSum(5), 12, "sum of fib(0..5) should be 12");
});

Deno.test("fibonacci - handles edge cases", () => {
  assertEquals(fibonacci(0), 0);
  assertEquals(fibonacci(1), 1);
  assertEquals(fibonacci(2), 1);
  assertEquals(fibonacci(3), 2);
  assertEquals(fibonacci(4), 3);
});
