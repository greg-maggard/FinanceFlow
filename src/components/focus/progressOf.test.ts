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

describe("progressOf SavePurchase", () => {
  it("keeps the legacy single-goal behavior without items", () => {
    const s = makeInitialState();
    s.nodes.SavePurchase.data = {
      goalName: "Car",
      target: 12000,
      saved: { value: 12000, source: "manual" },
    };
    expect(progressOf(s, "SavePurchase")).toEqual({ kind: "goal", value: 12000, max: 12000, ready: true });
  });

  it("aggregates saved and target across goals", () => {
    const s = makeInitialState();
    s.nodes.SavePurchase.data = {
      goalName: "Down payment",
      target: 52000,
      saved: { value: 27000, source: "manual" },
      items: [
        { id: "g1", name: "Down payment", target: 40000, saved: { value: 15000, source: "manual" }, byDate: "2028-06" },
        { id: "g2", name: "New car", target: 12000, saved: { value: 12000, source: "manual" } },
      ],
    };
    expect(progressOf(s, "SavePurchase")).toEqual({ kind: "goal", value: 27000, max: 52000, ready: false });
  });
});
