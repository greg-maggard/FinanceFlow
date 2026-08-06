import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../../state/store";
import { RTA_CATEGORY_ID } from "../../state/schema";
import { bookIntegrity, snapshot } from "../../budget/ledger";
import { ymKey } from "../../state/recurring";
import { BudgetScreen } from "./BudgetScreen";

const MONTH = ymKey();

/** Income in the viewed month plus two envelopes with monthly targets. */
function seed(income: number) {
  const s = useStore.getState();
  s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
  s.addTxn({
    id: "income",
    accountId: "checking",
    date: `${MONTH}-01`,
    payee: "Paycheck",
    amount: income,
    categoryId: RTA_CATEGORY_ID,
    source: "manual",
  });
  s.addGroup("Bills");
  const groupId = useStore.getState().budget.groups[0].id;
  s.addCategory(groupId, "Rent");
  s.addCategory(groupId, "Groceries");
  for (const [name, monthlyTarget] of [
    ["Rent", 1200],
    ["Groceries", 400],
  ] as const) {
    const cat = useStore.getState().budget.categories.find((c) => c.name === name)!;
    s.updateCategory({ ...cat, monthlyTarget });
  }
}

describe("BudgetScreen: fund this month", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("an untouched month says so instead of showing a wall of empty bars", () => {
    seed(2000);
    render(<BudgetScreen />);
    expect(screen.getByText("Nothing assigned yet this month")).toBeTruthy();
    expect(screen.queryByText("Monthly target")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Fund this month" })[0]);

    const snap = snapshot(useStore.getState().budget, MONTH);
    const byName = Object.fromEntries(
      useStore.getState().budget.categories.map((c) => [c.name, snap.categories[c.id]!]),
    );
    expect(byName.Rent.available).toBe(1200);
    expect(byName.Groceries.available).toBe(400);
    expect(snap.readyToAssign).toBe(400);
    expect(bookIntegrity(useStore.getState().budget, MONTH).drift).toBe(0);
    // The month is funded: the prompt gives way to the bars it replaced.
    expect(screen.queryByText("Nothing assigned yet this month")).toBeNull();
    expect(screen.getAllByText("Monthly target")).toHaveLength(2);
    // Nothing left to fund, so the button retires rather than lying.
    expect(screen.queryByRole("button", { name: "Fund this month" })).toBeNull();
  });

  it("reports what the money did not cover", () => {
    seed(1300);
    render(<BudgetScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fund this month" })[0]);

    expect(screen.getByText("Funded 1 of 2 envelopes — $300 short")).toBeTruthy();
    expect(snapshot(useStore.getState().budget, MONTH).readyToAssign).toBe(0);
    expect(bookIntegrity(useStore.getState().budget, MONTH).drift).toBe(0);
  });
});
