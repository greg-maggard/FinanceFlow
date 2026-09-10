import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../../state/store";
import { useUI } from "../../state/uiStore";
import { RTA_CATEGORY_ID } from "../../state/schema";
import { bookIntegrity, snapshot } from "../../budget/ledger";
import { ymKey } from "../../state/recurring";
import { CategoryGroups } from "./CategoryGroups";
import { UndoToast } from "../UndoToast";

const MONTH = ymKey();

/** A funded, spent-against category — exercises the "move & delete" arm. */
function seed() {
  const s = useStore.getState();
  s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
  s.addTxn({
    id: "income",
    accountId: "checking",
    date: `${MONTH}-01`,
    payee: "Paycheck",
    amount: 10_000,
    categoryId: RTA_CATEGORY_ID,
    source: "manual",
  });
  s.addGroup("Bills");
  const groupId = useStore.getState().budget.groups[0].id;
  s.addCategory(groupId, "Phone");
  const catId = useStore.getState().budget.categories[0].id;
  s.addTxn({
    id: "t1",
    accountId: "checking",
    date: `${MONTH}-05`,
    payee: "Verizon",
    amount: -4000,
    categoryId: catId,
    source: "manual",
  });
  s.assign(MONTH, catId, 5000);
  return catId;
}

function renderGroups() {
  const budget = useStore.getState().budget;
  const snap = snapshot(budget, MONTH);
  render(
    <>
      <CategoryGroups month={MONTH} snap={snap} />
      <UndoToast />
    </>,
  );
}

describe("CategoryGroups: delete undo (w3-search-undo)", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useUI.setState({ pendingUndo: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("the confirm-sheet arming step stays — deleting still takes two taps", () => {
    seed();
    renderGroups();

    fireEvent.click(screen.getByRole("button", { name: "Phone actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Phone" }));
    // Armed: the money-destination picker appears, nothing deleted yet.
    expect(screen.getByLabelText("Move Phone's transactions and money to")).toBeInTheDocument();
    expect(useStore.getState().budget.categories.map((c) => c.name)).toContain("Phone");
  });

  it("shows a five-second undo toast after the confirmed delete, and undo restores the exact prior book", () => {
    const catId = seed();
    renderGroups();
    expect(bookIntegrity(useStore.getState().budget, MONTH).drift).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Phone actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Phone" }));
    fireEvent.click(screen.getByRole("button", { name: "Move & delete Phone" }));

    // The delete already ran — no tombstone, a real mutation.
    expect(useStore.getState().budget.categories.map((c) => c.id)).not.toContain(catId);
    expect(useStore.getState().budget.transactions.find((t) => t.id === "t1")?.categoryId).not.toBe(
      catId,
    );
    expect(bookIntegrity(useStore.getState().budget, MONTH).drift).toBe(0);
    expect(screen.getByText("Deleted Phone")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const budget = useStore.getState().budget;
    expect(budget.categories.map((c) => c.id)).toContain(catId);
    expect(budget.transactions.find((t) => t.id === "t1")?.categoryId).toBe(catId);
    expect(budget.assignments[MONTH]?.[catId]).toBe(5000);
    expect(bookIntegrity(budget, MONTH).drift).toBe(0);
    // Accepted — nothing left pending. (Framer-motion's exit animation keeps
    // the toast's own DOM node around briefly, so the state, not the DOM, is
    // the reliable signal that undo has been consumed.)
    expect(useUI.getState().pendingUndo).toBeNull();
  });

  it("deletes outright with an undo toast when the envelope was never spent — no money picker needed", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addTxn({
      id: "income",
      accountId: "checking",
      date: `${MONTH}-01`,
      amount: 10_000,
      categoryId: RTA_CATEGORY_ID,
      source: "manual",
    });
    s.addGroup("Goals");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Typo");
    const catId = useStore.getState().budget.categories[0].id;
    s.assign(MONTH, catId, 1000);
    renderGroups();

    fireEvent.click(screen.getByRole("button", { name: "Typo actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Typo" }));
    fireEvent.click(screen.getByRole("button", { name: "Tap again to confirm" }));

    expect(useStore.getState().budget.categories).toEqual([]);
    expect(bookIntegrity(useStore.getState().budget, MONTH).drift).toBe(0);
    expect(screen.getByText("Deleted Typo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    const budget = useStore.getState().budget;
    expect(budget.categories.map((c) => c.id)).toContain(catId);
    expect(budget.assignments[MONTH]?.[catId]).toBe(1000);
    expect(bookIntegrity(budget, MONTH).drift).toBe(0);
  });
});
