import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeBigBook } from "./fixtures/bigBook";
import { snapshot, accountBalance } from "../budget/ledger";
import * as ledgerModule from "../budget/ledger";
import { useStore } from "../state/store";
import { BudgetScreen } from "../components/budget/BudgetScreen";
import * as TopBarModule from "../components/TopBar";
import * as CelebrationLayerModule from "../components/CelebrationLayer";
import * as OverviewSheetModule from "../components/OverviewSheet";

// This file is `.ts` (not `.tsx`, per w3-perf's file list), so component
// trees below are built with `createElement` rather than JSX syntax.

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

/**
 * w3-perf: a laggy budget-entry UI discourages the daily use this app exists
 * for. These benchmarks pin down the actual keystroke cost on a big book
 * (rather than guessing), and lock in the specific regression this pass
 * fixes: a single keystroke recomputing the whole ledger snapshot more than
 * once. See the commit message for recorded before/after numbers.
 */
describe("w3-perf: keystroke cost on a big book", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useStore.getState().reset();
  });

  /** Load `book` into the live store as the only state that changed from a fresh reset. */
  function seedBudget(txnCount: number) {
    useStore.getState().reset();
    useStore.getState().replaceAll({ ...useStore.getState(), budget: makeBigBook(txnCount) });
  }

  it("typing one character into a category's Assigned field invokes snapshot() exactly once", () => {
    seedBudget(20_000);
    render(createElement(BudgetScreen));

    // BudgetScreen's own `useMemo(() => snapshot(budget, month), [budget, month])`
    // is the only call site that should fire on this keystroke — every other
    // consumer either doesn't touch `budget` or reuses this same snapshot.
    const snapshotSpy = vi.spyOn(ledgerModule, "snapshot");

    const input = screen.getAllByLabelText(/^Assigned to /)[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });

    expect(snapshotSpy.mock.calls.length).toBe(1);
  });

  it("TopBar/CelebrationLayer/OverviewSheet — always-mounted siblings that don't touch `budget` — do not re-render on a Budget-screen keystroke", () => {
    // These three were the confirmed bare-`useStore()` offenders (finding 1):
    // always mounted alongside whichever screen is active, so a whole-store
    // subscription re-rendered them on every keystroke anywhere, including
    // ones that never touch the `nodes`/`decisions` slices they actually
    // read. Selector-scoping them means an `assign()` (which only replaces
    // `budget`) should produce zero extra renders here.
    seedBudget(1_000);
    const topBarSpy = vi.spyOn(TopBarModule, "TopBar");
    const celebrationSpy = vi.spyOn(CelebrationLayerModule, "CelebrationLayer");
    const overviewSpy = vi.spyOn(OverviewSheetModule, "OverviewSheet");

    render(
      createElement(
        "div",
        null,
        createElement(TopBarModule.TopBar, { onOpenSettings: () => {} }),
        createElement(CelebrationLayerModule.CelebrationLayer),
        createElement(OverviewSheetModule.OverviewSheet),
        createElement(BudgetScreen),
      ),
    );
    const mountCalls = {
      topBar: topBarSpy.mock.calls.length,
      celebration: celebrationSpy.mock.calls.length,
      overview: overviewSpy.mock.calls.length,
    };

    const input = screen.getAllByLabelText(/^Assigned to /)[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });

    expect(topBarSpy.mock.calls.length).toBe(mountCalls.topBar);
    expect(celebrationSpy.mock.calls.length).toBe(mountCalls.celebration);
    expect(overviewSpy.mock.calls.length).toBe(mountCalls.overview);
  });

  it("measures render cost of a single keystroke into a category's Assigned field", () => {
    console.log("\nKeystroke Render Cost (BudgetScreen, big book)");
    console.log("=".repeat(70));
    console.log("txnCount | keystroke render(ms, median of 7)");
    console.log("-".repeat(70));

    const txnCounts = [1000, 5000, 20000];

    for (const txnCount of txnCounts) {
      const times: number[] = [];
      for (let run = 0; run < 7; run++) {
        seedBudget(txnCount);
        const { unmount } = render(createElement(BudgetScreen));
        const input = screen.getAllByLabelText(/^Assigned to /)[0] as HTMLInputElement;

        const start = performance.now();
        fireEvent.change(input, { target: { value: String((run % 9) + 1) } });
        const end = performance.now();
        times.push(end - start);

        unmount();
      }
      const median = getMedian(times);
      console.log(`${String(txnCount).padStart(7)} | ${median.toFixed(3).padStart(31)}`);
    }

    console.log("=".repeat(70));
    expect(true).toBe(true);
  });
});

function getMedian(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
