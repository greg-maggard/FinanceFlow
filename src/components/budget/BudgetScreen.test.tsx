import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStore } from "../../state/store";
import { RTA_CATEGORY_ID, UNCATEGORIZED_CATEGORY_ID } from "../../state/schema";
import { bookIntegrity, isoDay, snapshot } from "../../budget/ledger";
import { ymKey } from "../../state/recurring";
import { BudgetScreen } from "./BudgetScreen";
import { dollars } from "./bits";

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

    // The tap asks first, naming the total and the envelope count.
    fireEvent.click(screen.getAllByRole("button", { name: "Fund this month" })[0]);
    expect(screen.getByText("Move $1,600 into 2 envelopes?")).toBeTruthy();
    expect(snapshot(useStore.getState().budget, MONTH).readyToAssign).toBe(2000);

    fireEvent.click(screen.getByRole("button", { name: "Move $1,600" }));

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
    // Nothing left to fund, so the button retires rather than lying — but the
    // receipt stays: a four-figure move must never happen silently.
    expect(screen.queryByRole("button", { name: "Fund this month" })).toBeNull();
    expect(screen.getByText("Funded 2 envelopes, $1,600 moved")).toBeTruthy();
  });

  it("cancelling the confirmation moves nothing", () => {
    seed(2000);
    render(<BudgetScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fund this month" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Move $1,600 into 2 envelopes?")).toBeNull();
    expect(useStore.getState().budget.assignments[MONTH]).toBeUndefined();
    expect(snapshot(useStore.getState().budget, MONTH).readyToAssign).toBe(2000);
    expect(screen.getAllByRole("button", { name: "Fund this month" }).length).toBeGreaterThan(0);
  });

  it("reports what the money did not cover", () => {
    seed(1300);
    render(<BudgetScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fund this month" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Move $1,300" }));

    expect(screen.getByText("Funded 2 envelopes, $1,300 moved — $300 still short")).toBeTruthy();
    expect(snapshot(useStore.getState().budget, MONTH).readyToAssign).toBe(0);
    expect(bookIntegrity(useStore.getState().budget, MONTH).drift).toBe(0);
  });

  it("with nothing to move there is nothing to confirm — it just says so", () => {
    seed(0);
    render(<BudgetScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fund this month" })[0]);

    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(
      screen.getByText("Nothing to move — Ready to Assign is empty, $1,600 still short"),
    ).toBeTruthy();
    expect(useStore.getState().budget.assignments[MONTH]).toBeUndefined();
  });

  it("spending a funded envelope down does not re-arm the button", () => {
    seed(2000);
    render(<BudgetScreen />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fund this month" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Move $1,600" }));
    expect(screen.queryByRole("button", { name: "Fund this month" })).toBeNull();

    const groceries = useStore.getState().budget.categories.find((c) => c.name === "Groceries")!;
    useStore.getState().addTxn({
      id: "spend",
      accountId: "checking",
      date: `${MONTH}-25`,
      payee: "Market",
      amount: -400,
      categoryId: groceries.id,
      source: "manual",
    });

    // The envelope is empty, but the month's contribution was already made —
    // offering the tap again would refund every dollar spent.
    const snap = snapshot(useStore.getState().budget, MONTH);
    expect(snap.categories[groceries.id]!.available).toBe(0);
    expect(screen.queryByRole("button", { name: "Fund this month" })).toBeNull();
    expect(snap.readyToAssign).toBe(400);
    expect(bookIntegrity(useStore.getState().budget, MONTH).drift).toBe(0);
  });
});

describe("BudgetScreen: today strip (w2-today-strip finding 9)", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows only two tiles on a fresh book — Uncategorized doesn't exist yet, so it isn't rendered as a dud", () => {
    render(<BudgetScreen />);

    // The strip is the grid containing the "Ready to Assign" label; on a
    // fresh book it has exactly two StripStat children, not three.
    // "On-budget cash" is unique to the today strip (the month header's RTA
    // pill also says "Ready to Assign", so that label alone is ambiguous).
    const strip = screen.getByText("On-budget cash").closest(".grid") as HTMLElement;
    expect(strip.children).toHaveLength(2);
    expect(within(strip).queryByText("Uncategorized")).toBeNull();
  });

  it("shows the third tile once Uncategorized is materialized by a real transaction", () => {
    useStore.getState().addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    useStore.getState().addTxn({
      id: "txn1",
      accountId: "checking",
      date: isoDay(),
      payee: "Misc",
      amount: -12,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "manual",
    });

    render(<BudgetScreen />);

    // "On-budget cash" is unique to the today strip (the month header's RTA
    // pill also says "Ready to Assign", so that label alone is ambiguous).
    const strip = screen.getByText("On-budget cash").closest(".grid") as HTMLElement;
    expect(strip.children).toHaveLength(3);
    const thirdTile = strip.children[2] as HTMLElement;
    expect(within(thirdTile).getByText("Uncategorized")).toBeTruthy();
    expect(within(thirdTile).getByText(dollars(-12))).toBeTruthy();
  });
});
