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

  it("edits a transaction's amount in place, adding no new row", () => {
    seedAccount();
    useStore.getState().addTxn({
      id: "t1",
      accountId: "checking",
      date: "2024-01-05",
      payee: "Grocery run",
      amount: -42.5,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "manual",
    });
    render(<TransactionsSection />);

    // Tapping the row — not the kebab — opens the same form pre-filled.
    fireEvent.click(screen.getByRole("button", { name: "Edit Grocery run" }));
    expect(screen.getByRole("heading", { name: "Edit transaction" })).toBeInTheDocument();
    const amountInput = screen.getByDisplayValue("42.5");
    fireEvent.change(amountInput, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(1);
    expect(budget.transactions[0].id).toBe("t1");
    expect(budget.transactions[0].amount).toBe(-50);
    expect(bookIntegrity(budget, "2024-01").drift).toBe(0);
    // The editor closes once the save lands.
    expect(screen.queryByRole("heading", { name: "Edit transaction" })).toBeNull();
  });

  it("refuses to open the editor on a transfer leg, with a clear explanation", () => {
    seedAccount();
    useStore.getState().addAccount({
      id: "savings",
      name: "Savings",
      kind: "savings",
      source: "manual",
    });
    render(<TransactionsSection />);
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    // [0] From (pre-selected Checking), [1] To.
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "savings" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Add transfer" }));

    fireEvent.click(screen.getByRole("button", { name: "Edit Transfer → Savings" }));
    expect(screen.getByText(/Transfers can't be edited here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/Transfers can't be edited here/)).toBeNull();

    // Neither leg was touched.
    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(2);
    expect(budget.transactions.every((t) => Math.abs(t.amount) === 100)).toBe(true);
    expect(bookIntegrity(budget, isoDay().slice(0, 7)).drift).toBe(0);
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
