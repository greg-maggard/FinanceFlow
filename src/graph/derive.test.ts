import { describe, expect, it } from "vitest";
import { makeInitialState } from "../state/schema";
import type { AppState, NodeId, RecurringData } from "../state/schema";
import { deriveStatus, monthlyBudgetSummary, recurringTotals } from "./derive";

function complete(state: AppState, ids: NodeId[]): AppState {
  const next = structuredClone(state);
  for (const id of ids) next.nodes[id].completed = true;
  return next;
}

describe("deriveStatus", () => {
  it("starts with Start as current and rest reachable or skipped", () => {
    const s = makeInitialState();
    const d = deriveStatus(s);
    expect(d.Start).toBe("current");
    expect(d.Rent).toBe("upcoming");
    // Both branches of unanswered decisions are reachable
    expect(d.Match).toBe("upcoming");
    expect(d.Q_HighDebt).toBe("upcoming");
  });

  it("advances to next task when current is completed", () => {
    let s = makeInitialState();
    s = complete(s, ["Start"]);
    const d = deriveStatus(s);
    expect(d.Start).toBe("done");
    expect(d.Rent).toBe("current");
  });

  it("walks through Step 0 linearly", () => {
    let s = makeInitialState();
    s = complete(s, ["Start", "Rent", "Food", "Essential", "Income", "Health"]);
    const d = deriveStatus(s);
    expect(d.MinDebt).toBe("current");
    expect(d.SmallEF).toBe("upcoming");
  });

  it("stops at unanswered decision and marks it current", () => {
    let s = makeInitialState();
    s = complete(s, [
      "Start", "Rent", "Food", "Essential", "Income", "Health", "MinDebt",
      "SmallEF", "NonEssential",
    ]);
    const d = deriveStatus(s);
    expect(d.Q_Match).toBe("current");
    expect(d.Match).toBe("upcoming");
    expect(d.Q_HighDebt).toBe("upcoming");
  });

  it("skips Match when Q_Match=no", () => {
    let s = makeInitialState();
    s = complete(s, [
      "Start", "Rent", "Food", "Essential", "Income", "Health", "MinDebt",
      "SmallEF", "NonEssential",
    ]);
    s.decisions.Q_Match = "no";
    const d = deriveStatus(s);
    expect(d.Q_Match).toBe("done");
    expect(d.Match).toBe("skipped");
    expect(d.Q_HighDebt).toBe("current");
  });

  it("includes Match in path when Q_Match=yes", () => {
    let s = makeInitialState();
    s = complete(s, [
      "Start", "Rent", "Food", "Essential", "Income", "Health", "MinDebt",
      "SmallEF", "NonEssential",
    ]);
    s.decisions.Q_Match = "yes";
    const d = deriveStatus(s);
    expect(d.Match).toBe("current");
  });

  it("detects 15% retirement loop and surfaces Q_15pct as current", () => {
    let s = makeInitialState();
    s = complete(s, [
      "Start", "Rent", "Food", "Essential", "Income", "Health", "MinDebt",
      "SmallEF", "NonEssential", "Match", "BigEF", "IRA", "Increase401k",
    ]);
    s.decisions.Q_Match = "yes";
    s.decisions.Q_HighDebt = "no";
    s.decisions.Q_ModDebt = "no";
    s.decisions.Q_Purchase = "no";
    s.decisions.Q_15pct = "no";
    s.decisions.Q_401k = "yes";
    const d = deriveStatus(s);
    expect(d.Q_15pct).toBe("current");
    expect(d.Increase401k).toBe("done");
  });

  it("Q_15pct=yes routes to Q_HSA", () => {
    let s = makeInitialState();
    s = complete(s, [
      "Start", "Rent", "Food", "Essential", "Income", "Health", "MinDebt",
      "SmallEF", "NonEssential", "Match", "BigEF", "IRA",
    ]);
    s.decisions.Q_Match = "yes";
    s.decisions.Q_HighDebt = "no";
    s.decisions.Q_ModDebt = "no";
    s.decisions.Q_Purchase = "no";
    s.decisions.Q_15pct = "yes";
    const d = deriveStatus(s);
    expect(d.Q_15pct).toBe("done");
    expect(d.Q_HSA).toBe("current");
    expect(d.Q_401k).toBe("skipped");
  });
});

describe("recurringTotals", () => {
  it("uses the single pair when there are no items", () => {
    const data: RecurringData = {
      target: { value: 500, source: "manual" },
      funded: { value: 200, source: "manual" },
    };
    expect(recurringTotals(data)).toEqual({ target: 500, funded: 200 });
  });

  it("sums the items when present, ignoring the top-level pair", () => {
    const data: RecurringData = {
      target: { value: 999, source: "manual" },
      funded: { value: 999, source: "manual" },
      items: [
        { id: "a", name: "Power", target: { value: 100, source: "manual" }, funded: { value: 80, source: "manual" } },
        { id: "b", name: "Water", target: { value: 50, source: "manual" } },
      ],
    };
    expect(recurringTotals(data)).toEqual({ target: 150, funded: 80 });
  });

  it("treats an empty items array like no items", () => {
    const data: RecurringData = {
      target: { value: 500, source: "manual" },
      funded: { value: 100, source: "manual" },
      items: [],
    };
    expect(recurringTotals(data)).toEqual({ target: 500, funded: 100 });
  });

  it("handles missing data", () => {
    expect(recurringTotals(undefined)).toEqual({ target: 0, funded: 0 });
  });
});

describe("monthlyBudgetSummary", () => {
  it("is zero on an untouched state", () => {
    expect(monthlyBudgetSummary(makeInitialState())).toEqual({ target: 0, funded: 0 });
  });

  it("sums single and itemized recurring nodes", () => {
    const s = makeInitialState();
    s.nodes.Rent.data = {
      target: { value: 1800, source: "manual" },
      funded: { value: 1800, source: "manual" },
    };
    s.nodes.Essential.data = {
      target: { value: 0, source: "manual" },
      items: [
        { id: "a", name: "Power", target: { value: 120, source: "manual" }, funded: { value: 90, source: "manual" } },
        { id: "b", name: "Water", target: { value: 40, source: "manual" }, funded: { value: 40, source: "manual" } },
      ],
    };
    expect(monthlyBudgetSummary(s)).toEqual({ target: 1960, funded: 1930 });
  });
});
