import { describe, expect, it } from "vitest";

// Smoke test: proves the test runner and TypeScript setup work. Replaced by real tests in step 2.
describe("setup", () => {
  it("runs TypeScript tests", () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(1, 2)).toBe(3);
  });
});
