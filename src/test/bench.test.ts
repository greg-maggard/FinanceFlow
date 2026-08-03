import { describe, it, expect } from "vitest";
import { makeBigBook } from "./fixtures/bigBook";
import { snapshot, accountBalance } from "../budget/ledger";

describe("performance benchmarks", () => {
  it("measures snapshot and accountBalance performance", () => {
    console.log("\nPerformance Benchmarks");
    console.log("=".repeat(70));
    console.log("txnCount | snapshot(ms) | accountBalance x8 (ms)");
    console.log("-".repeat(70));

    const txnCounts = [100, 1000, 5000, 20000];

    for (const txnCount of txnCounts) {
      const book = makeBigBook(txnCount);

      // Benchmark snapshot()
      const snapshotTimes: number[] = [];
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        snapshot(book, "2025-06");
        const end = performance.now();
        snapshotTimes.push(end - start);
      }
      const snapshotMedian = getMedian(snapshotTimes);

      // Benchmark accountBalance() across all 8 accounts
      const balanceTimes: number[] = [];
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        for (let i = 0; i < 8; i++) {
          accountBalance(book, `acct-${i}`);
        }
        const end = performance.now();
        balanceTimes.push(end - start);
      }
      const balanceMedian = getMedian(balanceTimes);

      console.log(
        `${String(txnCount).padStart(7)} | ${snapshotMedian.toFixed(2).padStart(11)} | ${balanceMedian.toFixed(2).padStart(20)}`,
      );
    }

    console.log("=".repeat(70));

    // Trivial assertion to make this a valid test
    expect(true).toBe(true);
  });
});

function getMedian(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
