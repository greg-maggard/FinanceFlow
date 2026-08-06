import { describe, expect, it } from "vitest";
import { RTA_CATEGORY_ID, makeInitialState } from "../state/schema";
import type { AppState, Category, NodeId } from "../state/schema";
import { deriveStatus, monthlyBudgetSummary, overallProgress } from "./derive";
import { ymKey } from "../state/recurring";

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

  it("marking a recurring node complete (toggleComplete) advances the graph to the next node", () => {
    let s = makeInitialState();
    s = complete(s, ["Start", "Rent"]);
    const d = deriveStatus(s);
    expect(d.Rent).toBe("done");
    expect(d.Food).toBe("current");
  });

  it("setting monthlyChecks alone (monthly check-in) leaves overallProgress unchanged", () => {
    const s = makeInitialState();
    const before = overallProgress(s);
    const withCheckIn = structuredClone(s);
    withCheckIn.nodes.Rent.monthlyChecks = { [ymKey()]: true };
    const after = overallProgress(withCheckIn);
    expect(after).toEqual(before);
    expect(deriveStatus(withCheckIn).Rent).toBe("upcoming");
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

describe("monthlyBudgetSummary", () => {
  const MONTH = "2026-06";

  function cat(partial: Partial<Category> & Pick<Category, "id" | "nodeId">): Category {
    return { groupId: "g:bills", name: partial.id, order: 0, ...partial };
  }

  /** A state whose book has an on-budget account and an RTA inflow funding it. */
  function seeded(
    categories: Category[],
    assignments: Record<string, number>,
  ): AppState {
    const s = makeInitialState();
    s.budget.accounts = [{ id: "checking", name: "checking", kind: "checking", source: "manual" }];
    s.budget.transactions = [
      { id: "t:rta", accountId: "checking", date: "2026-06-01", amount: 100000, categoryId: RTA_CATEGORY_ID, source: "manual" },
    ];
    s.budget.categories = categories;
    s.budget.assignments = { [MONTH]: assignments };
    return s;
  }

  it("is zero on an untouched state", () => {
    expect(monthlyBudgetSummary(makeInitialState(), MONTH)).toEqual({ target: 0, funded: 0 });
  });

  it("sums targets and assignments across the recurring nodes' categories", () => {
    const s = seeded(
      [
        cat({ id: "Rent", nodeId: "Rent", monthlyTarget: 1800 }),
        cat({ id: "Essential:power", nodeId: "Essential", monthlyTarget: 120 }),
        cat({ id: "Essential:water", nodeId: "Essential", monthlyTarget: 40 }),
      ],
      { Rent: 1800, "Essential:power": 90, "Essential:water": 40 },
    );
    expect(monthlyBudgetSummary(s, MONTH)).toEqual({ target: 1960, funded: 1930 });
  });

  it("summary sums stay exact across fractional amounts and nodes", () => {
    const s = seeded(
      [
        cat({ id: "Rent", nodeId: "Rent", monthlyTarget: 0.1 }),
        cat({ id: "Food", nodeId: "Food", monthlyTarget: 0.2 }),
      ],
      { Rent: 0.1, Food: 0.2 },
    );
    expect(monthlyBudgetSummary(s, MONTH)).toEqual({ target: 0.3, funded: 0.3 });
  });
});
