import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../../state/store";
import { UNCATEGORIZED_CATEGORY_ID } from "../../state/schema";
import { bookIntegrity, isoDay } from "../../budget/ledger";
import { TransactionsSection } from "./TransactionsSection";

function seedAccount() {
  useStore.getState().addAccount({
    id: "checking",
    name: "Checking",
    kind: "checking",
    source: "manual",
  });
}

function seedTxns(count: number) {
  const s = useStore.getState();
  for (let i = 0; i < count; i++) {
    s.addTxn({
      id: `t${i}`,
      accountId: "checking",
      date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
      payee: `Payee ${i}`,
      amount: -(i + 1),
      source: "manual",
    });
  }
}

describe("TransactionsSection", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  it("caps the initial render at 50 rows", () => {
    seedAccount();
    seedTxns(120);
    render(<TransactionsSection />);
    expect(screen.getAllByText(/^Payee \d+$/)).toHaveLength(50);
  });

  it("reveals 50 more rows per 'Show more' activation", () => {
    seedAccount();
    seedTxns(120);
    render(<TransactionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByText(/^Payee \d+$/)).toHaveLength(100);

    // Only 20 remain, so the next page caps at the true total instead of
    // overshooting to 150.
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByText(/^Payee \d+$/)).toHaveLength(120);
    // Fully revealed: the control disappears.
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("shows an accurate 'N of total' count indicator", () => {
    seedAccount();
    seedTxns(120);
    render(<TransactionsSection />);
    expect(screen.getByText("50 of 120")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("100 of 120")).toBeInTheDocument();
  });

  it("saves an expense into the Uncategorized envelope when nothing is picked", () => {
    seedAccount();
    render(<TransactionsSection />);
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "12.34" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));

    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(1);
    expect(budget.transactions[0].categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
    expect(budget.transactions[0].amount).toBe(-12.34);
    // The envelope is real now: visible, assignable, and holding the spend, so
    // none of the money sits outside the envelope system.
    expect(budget.categories.map((c) => c.id)).toContain(UNCATEGORIZED_CATEGORY_ID);
    // The form dates the row today, and bookIntegrity is only meaningful for a
    // month that has already seen every dollar it counts.
    const integrity = bookIntegrity(budget, isoDay().slice(0, 7));
    expect(integrity.unbudgetedSpending).toBe(0);
    expect(integrity.drift).toBe(0);
  });

  it("still yields a categoryId when the user picks '— No category —'", () => {
    seedAccount();
    render(<TransactionsSection />);
    // [0] is the account picker, [1] the category picker.
    const category = screen.getAllByRole("combobox")[1];
    fireEvent.change(category, { target: { value: "" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));

    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(1);
    expect(budget.transactions[0].categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
  });

  it("still yields a categoryId on a cross-boundary transfer when the user picks '— No category —'", () => {
    seedAccount();
    useStore.getState().addAccount({
      id: "brokerage",
      name: "Brokerage",
      kind: "tracking",
      source: "manual",
    });
    render(<TransactionsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    // [0] is From (pre-selected to Checking), [1] is To; the budget-side
    // category picker only appears once the pair crosses the boundary.
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "brokerage" } });
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Add transfer" }));

    const budget = useStore.getState().budget;
    const outflow = budget.transactions.find((t) => t.accountId === "checking");
    expect(outflow?.amount).toBe(-500);
    // The dollars leave the budget, so they have to leave an envelope too.
    expect(outflow?.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
    // And the envelope they name is a real, rendered row (store.addTransfer).
    expect(budget.categories.map((c) => c.id)).toContain(UNCATEGORIZED_CATEGORY_ID);
    // The tracking-side leg stays out of the budget entirely.
    expect(budget.transactions.find((t) => t.accountId === "brokerage")?.categoryId).toBeUndefined();
    const integrity = bookIntegrity(budget, isoDay().slice(0, 7));
    expect(integrity.unbudgetedSpending).toBe(0);
    expect(integrity.drift).toBe(0);
  });

  it("renders the empty state with no transactions", () => {
    seedAccount();
    render(<TransactionsSection />);
    expect(
      screen.getByText("No transactions yet — income lands in Ready to Assign."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    // No count indicator when the list is empty.
    expect(screen.queryByText(/^0 of/)).toBeNull();
  });
});
