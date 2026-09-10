import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import { UNCATEGORIZED_CATEGORY_ID } from "../../state/schema";
import { bookIntegrity, isoDay } from "../../budget/ledger";
import { TransactionsSection } from "./TransactionsSection";
import { UndoToast } from "../UndoToast";

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
      amount: -(i + 1) * 100,
      source: "manual",
    });
  }
}

describe("TransactionsSection", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useUI.setState({ pendingUndo: null });
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
    expect(budget.transactions[0].amount).toBe(-1234);
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
    expect(outflow?.amount).toBe(-50_000);
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
      amount: -4250,
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
    expect(budget.transactions[0].amount).toBe(-5000);
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
    expect(budget.transactions.every((t) => Math.abs(t.amount) === 10_000)).toBe(true);
    expect(bookIntegrity(budget, isoDay().slice(0, 7)).drift).toBe(0);
  });

  it("does not open the editor when Enter is pressed on the kebab button (reviewer repro)", () => {
    // Old shape: TxnRow's role="button" wrapped the KebabMenu, so a keydown
    // on the kebab bubbled up and the row's own onKeyDown preventDefault'd +
    // opened Edit before the kebab ever saw the key. The kebab button is now
    // a sibling of the row's edit button, not a descendant, so this keydown
    // has nothing above it to bubble into.
    seedAccount();
    useStore.getState().addTxn({
      id: "t1",
      accountId: "checking",
      date: "2024-01-05",
      payee: "Grocery run",
      amount: -4250,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "manual",
    });
    render(<TransactionsSection />);

    const kebab = screen.getByRole("button", { name: "Transaction actions" });
    fireEvent.keyDown(kebab, { key: "Enter" });
    expect(screen.queryByRole("heading", { name: "Edit transaction" })).toBeNull();
  });

  it("does not open the editor when Enter is pressed on Delete transaction, and Delete stays reachable (reviewer repro)", () => {
    seedAccount();
    useStore.getState().addTxn({
      id: "t1",
      accountId: "checking",
      date: "2024-01-05",
      payee: "Grocery run",
      amount: -4250,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "manual",
    });
    render(<TransactionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Transaction actions" }));
    const deleteButton = screen.getByRole("button", { name: "Delete transaction" });
    fireEvent.keyDown(deleteButton, { key: "Enter" });
    expect(screen.queryByRole("heading", { name: "Edit transaction" })).toBeNull();
    expect(useStore.getState().budget.transactions).toHaveLength(1);

    // Delete is reachable — its own click handler (which Enter/Space on a
    // real <button> activates) still deletes the row.
    fireEvent.click(deleteButton);
    expect(useStore.getState().budget.transactions).toHaveLength(0);
  });

  it("refuses to open the editor on a balance-adjustment row, with a clear explanation", () => {
    seedAccount();
    // A write-off dated inside August: outstandingAdjustments keys the
    // unwind window on this date, so it must not be reachable for editing.
    useStore.getState().addTxn({
      id: "txn:adjust:food:2024-01-15",
      accountId: "acct:adjust",
      date: "2024-01-15",
      payee: "Balance adjustment",
      amount: -5000,
      categoryId: "food",
      source: "manual",
    });
    render(<TransactionsSection />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Balance adjustment" }));
    expect(
      screen.getByText(/Balance adjustments can't be edited here/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText(/Balance adjustments can't be edited here/)).toBeNull();

    // The row was never touched.
    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(1);
    expect(budget.transactions[0].date).toBe("2024-01-15");
    expect(budget.transactions[0].accountId).toBe("acct:adjust");
    expect(bookIntegrity(budget, "2024-01").drift).toBe(0);
  });

  // w3-plaid-ui: the review queue — a count badge, a filter toggle behind
  // it, and a two-tap inline category picker on each uncategorized row.
  it("shows a badge with the uncategorized count, and hides it once nothing is left to review", () => {
    seedAccount();
    useStore.getState().addGroup("Everyday");
    const groupId = useStore.getState().budget.groups[0].id;
    useStore.getState().addCategory(groupId, "Coffee Shops");
    const categoryId = useStore.getState().budget.categories[0].id;
    useStore.getState().addTxn({
      id: "u1",
      accountId: "checking",
      date: "2024-01-05",
      payee: "Coffee Roasters",
      amount: -450,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "plaid",
      plaidTxnId: "syn:1",
    });
    render(<TransactionsSection />);

    const badge = screen.getByRole("button", { name: /Uncategorized/ });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("1");

    fireEvent.change(screen.getByLabelText("Categorize Coffee Roasters"), {
      target: { value: categoryId },
    });

    expect(screen.queryByRole("button", { name: /Uncategorized/ })).toBeNull();
  });

  it("filters down to the review queue behind the badge toggle", () => {
    seedAccount();
    useStore.getState().addTxn({
      id: "u1",
      accountId: "checking",
      date: "2024-01-05",
      payee: "Coffee Roasters",
      amount: -450,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "plaid",
      plaidTxnId: "syn:1",
    });
    useStore.getState().addTxn({
      id: "c1",
      accountId: "checking",
      date: "2024-01-06",
      payee: "Already sorted",
      amount: -1000,
      categoryId: "some-other-envelope",
      source: "manual",
    });
    render(<TransactionsSection />);

    expect(screen.getByText("Already sorted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Uncategorized/ }));
    expect(screen.getByText("Coffee Roasters")).toBeInTheDocument();
    expect(screen.queryByText("Already sorted")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Uncategorized/ }));
    expect(screen.getByText("Already sorted")).toBeInTheDocument();
  });

  it("categorizes an uncategorized row in two taps from the review queue, and the badge counts down", () => {
    seedAccount();
    useStore.getState().addGroup("Everyday");
    const groupId = useStore.getState().budget.groups[0].id;
    useStore.getState().addCategory(groupId, "Coffee Shops");
    const categoryId = useStore.getState().budget.categories[0].id;

    useStore.getState().addTxn({
      id: "u1",
      accountId: "checking",
      date: "2024-01-05",
      payee: "Coffee Roasters",
      amount: -450,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "plaid",
      plaidTxnId: "syn:1",
    });
    render(<TransactionsSection />);

    // Tap 1: filter into the review queue.
    fireEvent.click(screen.getByRole("button", { name: /Uncategorized/ }));
    // Tap 2 (a native select stands in for open+choose in jsdom): pick the
    // envelope from the inline picker.
    fireEvent.change(screen.getByLabelText("Categorize Coffee Roasters"), {
      target: { value: categoryId },
    });

    const budget = useStore.getState().budget;
    expect(budget.transactions.find((t) => t.id === "u1")?.categoryId).toBe(categoryId);
    expect(bookIntegrity(budget, "2024-01").drift).toBe(0);
    // Nothing left to review — the badge and the queue are both gone.
    expect(screen.queryByRole("button", { name: /Uncategorized/ })).toBeNull();
    expect(screen.getByText("Coffee Roasters")).toBeInTheDocument();
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

  // w3-search-undo: a payee text filter and a category filter, applied
  // before paging so they reach the full history, not just the visible page.
  describe("search and filter", () => {
    it("filters the full transaction history by payee, not just the current page", () => {
      seedAccount();
      seedTxns(120); // "Payee 0".."Payee 119", none of which contain "special"
      useStore.getState().addTxn({
        id: "special",
        accountId: "checking",
        date: "2024-01-15",
        payee: "Very Special Coffee Co",
        amount: -999,
        source: "manual",
      });
      render(<TransactionsSection />);

      // Beyond page 1 (50 rows) and not currently rendered.
      expect(screen.queryByText("Very Special Coffee Co")).toBeNull();

      fireEvent.change(screen.getByLabelText("Search transactions by payee"), {
        target: { value: "special" },
      });

      // Case-insensitive substring match found it despite paging.
      expect(screen.getByText("Very Special Coffee Co")).toBeInTheDocument();
      expect(screen.getByText("1 of 1")).toBeInTheDocument();
      expect(screen.queryByText(/^Payee \d+$/)).toBeNull();
    });

    it("filters by a real category via the shared category filter", () => {
      seedAccount();
      useStore.getState().addGroup("Everyday");
      const groupId = useStore.getState().budget.groups[0].id;
      useStore.getState().addCategory(groupId, "Coffee Shops");
      const coffeeId = useStore.getState().budget.categories[0].id;
      useStore.getState().addTxn({
        id: "c1",
        accountId: "checking",
        date: "2024-01-05",
        payee: "Roasters",
        amount: -400,
        categoryId: coffeeId,
        source: "manual",
      });
      useStore.getState().addTxn({
        id: "c2",
        accountId: "checking",
        date: "2024-01-06",
        payee: "Bookstore",
        amount: -1200,
        categoryId: coffeeId,
        source: "manual",
      });
      useStore.getState().addTxn({
        id: "u1",
        accountId: "checking",
        date: "2024-01-07",
        payee: "Misc",
        amount: -300,
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        source: "manual",
      });
      render(<TransactionsSection />);

      expect(screen.getByText("Misc")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Filter by category"), {
        target: { value: coffeeId },
      });

      expect(screen.getByText("Roasters")).toBeInTheDocument();
      expect(screen.getByText("Bookstore")).toBeInTheDocument();
      expect(screen.queryByText("Misc")).toBeNull();
    });
  });

  // w3-search-undo: deleting a transaction is now a single tap (the old
  // two-tap arming — if it were ever here — is gone); a five-second undo
  // toast is the safety net instead.
  describe("delete undo", () => {
    function renderWithToast() {
      render(
        <>
          <TransactionsSection />
          <UndoToast />
        </>,
      );
    }

    it("deletes on a single tap and shows an undo toast; accepting undo restores the exact row, id included, with drift 0 throughout", () => {
      seedAccount();
      useStore.getState().addTxn({
        id: "t1",
        accountId: "checking",
        date: "2024-01-05",
        payee: "Grocery run",
        amount: -4250,
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        source: "manual",
      });
      renderWithToast();
      expect(bookIntegrity(useStore.getState().budget, "2024-01").drift).toBe(0);

      fireEvent.click(screen.getByRole("button", { name: "Transaction actions" }));
      // Single tap — no arming/"tap again" step in between.
      fireEvent.click(screen.getByRole("button", { name: "Delete transaction" }));

      expect(useStore.getState().budget.transactions).toHaveLength(0);
      expect(bookIntegrity(useStore.getState().budget, "2024-01").drift).toBe(0);
      expect(screen.getByText('Deleted "Grocery run"')).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));

      const budget = useStore.getState().budget;
      expect(budget.transactions).toHaveLength(1);
      expect(budget.transactions[0].id).toBe("t1");
      expect(budget.transactions[0].payee).toBe("Grocery run");
      expect(bookIntegrity(budget, "2024-01").drift).toBe(0);
      // Accepted — nothing left pending (framer-motion's exit animation keeps
      // the toast's own DOM node around briefly, so the state, not the DOM,
      // is the reliable signal that undo has been consumed).
      expect(useUI.getState().pendingUndo).toBeNull();
    });

    it("restores both legs of a deleted transfer together", () => {
      seedAccount();
      useStore.getState().addAccount({
        id: "savings",
        name: "Savings",
        kind: "savings",
        source: "manual",
      });
      useStore.getState().addTransfer({
        from: "checking",
        to: "savings",
        amount: 5000,
        date: "2024-01-05",
      });
      renderWithToast();
      expect(useStore.getState().budget.transactions).toHaveLength(2);

      // Both legs render their own row, each with its own kebab — either
      // one's "Delete transfer" removes the pair together.
      fireEvent.click(screen.getAllByRole("button", { name: "Transaction actions" })[0]);
      fireEvent.click(screen.getByRole("button", { name: "Delete transfer" }));

      expect(useStore.getState().budget.transactions).toHaveLength(0);
      expect(screen.getByText("Transfer deleted")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));

      const budget = useStore.getState().budget;
      expect(budget.transactions).toHaveLength(2);
      expect(budget.transactions.every((t) => Math.abs(t.amount) === 5000)).toBe(true);
      expect(bookIntegrity(budget, "2024-01").drift).toBe(0);
    });

    it("auto-dismisses the undo toast after five seconds without restoring anything", () => {
      vi.useFakeTimers();
      seedAccount();
      useStore.getState().addTxn({
        id: "t1",
        accountId: "checking",
        date: "2024-01-05",
        payee: "Grocery run",
        amount: -4250,
        categoryId: UNCATEGORIZED_CATEGORY_ID,
        source: "manual",
      });
      renderWithToast();

      fireEvent.click(screen.getByRole("button", { name: "Transaction actions" }));
      fireEvent.click(screen.getByRole("button", { name: "Delete transaction" }));
      expect(useUI.getState().pendingUndo).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(useUI.getState().pendingUndo).toBeNull();
      expect(useStore.getState().budget.transactions).toHaveLength(0);
      vi.useRealTimers();
    });
  });
});
