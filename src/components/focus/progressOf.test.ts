import { describe, expect, it } from "vitest";
import { makeInitialState } from "../../state/schema";
import type { EFBucket } from "../../state/schema";
import { progressOf } from "./progressOf";

function buckets(...specs: [string, number, number][]): EFBucket[] {
  return specs.map(([name, target, balance], i) => ({
    id: `b${i}`,
    name,
    target,
    balance: { value: balance, source: "manual" },
  }));
}

describe("progressOf emergency funds", () => {
  it("SmallEF keeps the single-balance behavior without buckets", () => {
    const s = makeInitialState();
    s.settings.monthlyExpenses = 3000;
    s.nodes.SmallEF.data = { balance: { value: 3000, source: "manual" } };
    expect(progressOf(s, "SmallEF")).toEqual({ kind: "goal", value: 3000, max: 3000, ready: true });
  });

  it("buckets sum the balance but never shrink the computed target", () => {
    const s = makeInitialState();
    s.settings.monthlyExpenses = 3000;
    s.nodes.SmallEF.data = {
      balance: { value: 0, source: "manual" },
      items: buckets(["Medical", 1000, 800], ["Car", 500, 500]),
    };
    expect(progressOf(s, "SmallEF")).toEqual({ kind: "goal", value: 1300, max: 3000, ready: false });
  });

  it("bucket targets beyond the computed milestone grow the goal", () => {
    const s = makeInitialState();
    s.settings.monthlyExpenses = 3000;
    s.nodes.BigEF.data = {
      targetMonths: 3,
      balance: { value: 0, source: "manual" },
      items: buckets(["Medical", 6000, 6000], ["Home", 5000, 4000]),
    };
    expect(progressOf(s, "BigEF")).toEqual({ kind: "goal", value: 10000, max: 11000, ready: false });
  });

  it("BigEF buckets define the goal when expenses are unset", () => {
    const s = makeInitialState();
    s.nodes.BigEF.data = {
      targetMonths: 6,
      balance: { value: 0, source: "manual" },
      items: buckets(["Car", 4000, 4000]),
    };
    expect(progressOf(s, "BigEF")).toEqual({ kind: "goal", value: 4000, max: 4000, ready: true });
  });
});
