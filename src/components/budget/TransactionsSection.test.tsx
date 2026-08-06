import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../../state/store";
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
