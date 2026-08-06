import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../state/store";
import { useUI } from "../state/uiStore";
import { UNCATEGORIZED_CATEGORY_ID } from "../state/schema";
import { bookIntegrity, isoDay } from "../budget/ledger";
import { AddTransactionFab } from "./AddTransactionFab";

function seedAccount(id = "checking", name = "Checking") {
  useStore.getState().addAccount({ id, name, kind: "checking", source: "manual" });
}

describe("AddTransactionFab (w2-fastentry)", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useUI.setState({ lastUsedTxn: null, view: "budget" });
  });

  afterEach(() => {
    cleanup();
  });

  it("is visible on cold open with no navigation required", () => {
    seedAccount();
    render(<AddTransactionFab />);
    expect(screen.getByRole("button", { name: "Add transaction" })).toBeInTheDocument();
  });

  it("logs a $4.50 coffee in exactly 3 interactions: tap FAB, type amount, tap Save", () => {
    seedAccount();
    render(<AddTransactionFab />);

    // 1. Tap FAB.
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    // Amount is first, autofocused, and the only field that has to be typed.
    const amountField = screen.getByPlaceholderText("0");
    expect(amountField).toHaveFocus();
    expect(amountField.getAttribute("inputmode")).toBe("decimal");

    // 2. Type amount.
    fireEvent.change(amountField, { target: { value: "4.50" } });
    // 3. Tap Save.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(1);
    expect(budget.transactions[0].amount).toBe(-4.5);
    expect(budget.transactions[0].accountId).toBe("checking");
    expect(budget.transactions[0].date).toBe(isoDay());
    // Never blank (w1-bug3's honest fallback), since nothing was picked.
    expect(budget.transactions[0].categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);

    const integrity = bookIntegrity(budget, isoDay().slice(0, 7));
    expect(integrity.unbudgetedSpending).toBe(0);
    expect(integrity.drift).toBe(0);

    // The sheet closes and a confirmation names the amount and envelope.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Added $4.50 to Uncategorized");
  });

  it("orders fields Amount, then Category, then optional Payee", () => {
    seedAccount();
    render(<AddTransactionFab />);
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    const labels = screen.getAllByText(/Amount \$|Category|Payee/);
    expect(labels.map((l) => l.textContent)).toEqual(["Amount $", "Category", "Payee (optional)"]);
  });

  it("pre-fills the account, today's date, and the last-used category for that account", () => {
    seedAccount("checking", "Checking");
    useStore.getState().addAccount({ id: "savings", name: "Savings", kind: "savings", source: "manual" });
    useStore.getState().addGroup("Food");
    const groupId = useStore.getState().budget.groups[0].id;
    useStore.getState().addCategory(groupId, "Groceries");
    const groceriesId = useStore.getState().budget.categories[0].id;

    useUI.setState({
      lastUsedTxn: { accountId: "savings", categoryByAccount: { savings: groceriesId } },
    });

    render(<AddTransactionFab />);
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    // Two accounts exist, so the Account selector is shown; both it and the
    // Category selector should already read the most-recently-used pair.
    const [categorySelect, accountSelect] = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(accountSelect.value).toBe("savings");
    expect(categorySelect.value).toBe(groceriesId);

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const txn = useStore.getState().budget.transactions[0];
    expect(txn.accountId).toBe("savings");
    expect(txn.categoryId).toBe(groceriesId);
  });

  it("remembers the category per account after a save, for next time", () => {
    seedAccount("checking", "Checking");
    useStore.getState().addGroup("Food");
    const groupId = useStore.getState().budget.groups[0].id;
    useStore.getState().addCategory(groupId, "Coffee");
    const coffeeId = useStore.getState().budget.categories[0].id;

    render(<AddTransactionFab />);
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: coffeeId } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "4.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(useUI.getState().lastUsedTxn).toEqual({
      accountId: "checking",
      categoryByAccount: { checking: coffeeId },
    });

    // Reopening pre-fills the remembered category without any more taps.
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    const categorySelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(categorySelect.value).toBe(coffeeId);
  });

  it("shows an 'add an account first' message instead of the form when there are no accounts", () => {
    render(<AddTransactionFab />);
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    expect(
      screen.getByText("Add an account first — transactions need a home."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("offers a mode switch to the full income/transfer form without duplicating it", () => {
    seedAccount();
    render(<AddTransactionFab />);
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));

    fireEvent.click(screen.getByRole("button", { name: "Income" }));
    // The full form's own "Add income" submit button appears in income mode.
    expect(screen.getByRole("button", { name: "Add income" })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add income" }));

    const budget = useStore.getState().budget;
    expect(budget.transactions[0].amount).toBe(1000);
    expect(screen.getByRole("status")).toHaveTextContent("Added $1,000 to Ready to Assign");
  });

  it("hides the FAB while the Overview sheet is open, so it never covers the bottom-right node tile", () => {
    seedAccount();
    render(<AddTransactionFab />);
    expect(screen.getByRole("button", { name: "Add transaction" })).toBeInTheDocument();

    act(() => {
      useUI.setState({ view: "overview" });
    });
    expect(screen.queryByRole("button", { name: "Add transaction" })).toBeNull();

    act(() => {
      useUI.setState({ view: "budget" });
    });
    expect(screen.getByRole("button", { name: "Add transaction" })).toBeInTheDocument();
  });

  it("closing the sheet with the mouse outside does not save anything", () => {
    seedAccount();
    render(<AddTransactionFab />);
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useStore.getState().budget.transactions).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
