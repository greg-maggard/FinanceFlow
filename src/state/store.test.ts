import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapter, flushSave, useStore } from "./store";
import { UNCATEGORIZED_CATEGORY_ID } from "./schema";
import { useUI } from "./uiStore";
import { bookIntegrity, snapshot } from "../budget/ledger";
import { ADJUST_ACCOUNT_ID, planBalanceEdit } from "../budget/nodeLedger";
import { ymKey } from "./recurring";

// File-scope reset: a failing assertion must not leak one block's accounts,
// transactions or assignments into the next, turning one real failure into
// several misleading ones.
afterEach(() => {
  useStore.getState().reset();
});

describe("persistence debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().reset();
    // Prime the debounce baseline so the reset() itself doesn't count as
    // one of the writes a test is asserting about.
    flushSave();
  });

  afterEach(() => {
    flushSave();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces N rapid mutations into exactly one write", () => {
    const spy = vi.spyOn(adapter, "save");
    const s = useStore.getState();
    for (let i = 0; i < 5; i++) s.setNotes("Start", `note ${i}`);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(1);
    // Trailing edge: the one write reflects the last keystroke, not the first.
    expect(spy.mock.calls[0][0].nodes.Start.notes).toBe("note 4");
  });

  it("flushSave() writes immediately without waiting for the debounce timer", () => {
    const spy = vi.spyOn(adapter, "save");
    useStore.getState().setNotes("Start", "flushed");
    expect(spy).not.toHaveBeenCalled();
    flushSave();
    expect(spy).toHaveBeenCalledTimes(1);
    // No duplicate write once the original timer would have fired.
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a no-op set produces no write", () => {
    const spy = vi.spyOn(adapter, "save");
    // deleteTxn on an id that doesn't exist returns {} — a set() with no
    // field of the persisted slice actually changing by reference.
    useStore.getState().deleteTxn("does-not-exist");
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
    expect(bookIntegrity(useStore.getState().budget, "2026-06").drift).toBe(0);
  });
});

describe("a failed save surfaces in the UI", () => {
  afterEach(() => {
    useStore.getState().reset();
    useUI.setState({ saveError: null, lastSavedAt: null });
    vi.restoreAllMocks();
  });

  it("sets saveError on a quota-exceeded write, and a later successful save clears it", async () => {
    useStore.getState().reset();
    // The test env's localStorage stand-in (see src/test/setup.ts) is a
    // plain object, not a Storage instance — spy on the instance directly.
    const setItemSpy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    useStore.getState().setNotes("Start", "this write will fail");
    flushSave();

    await vi.waitFor(() => {
      expect(useUI.getState().saveError).not.toBeNull();
    });
    expect(useUI.getState().saveError).toMatch(/couldn't save/i);

    // Storage recovers (e.g. the browser freed up space) — the very next
    // mutation should retry rather than staying skipped as already-durable.
    setItemSpy.mockRestore();
    useStore.getState().setNotes("Start", "this write will succeed");
    flushSave();

    await vi.waitFor(() => {
      expect(useUI.getState().saveError).toBeNull();
    });
    expect(useUI.getState().lastSavedAt).not.toBeNull();
  });
});

describe("deleteCategory", () => {
  it("moves transactions and money to the chosen envelope", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addGroup("Bills");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Phone");
    const catId = useStore.getState().budget.categories[0].id;
    s.addTxn({
      id: "t1",
      accountId: "checking",
      date: "2026-06-01",
      amount: 1000,
      categoryId: "rta",
      source: "manual",
    });
    s.addTxn({
      id: "t2",
      accountId: "checking",
      date: "2026-06-05",
      amount: -40,
      categoryId: catId,
      source: "manual",
    });
    s.assign("2026-06", catId, 100);
    expect(snapshot(useStore.getState().budget, "2026-06").readyToAssign).toBe(900);

    useStore.getState().deleteCategory(catId, UNCATEGORIZED_CATEGORY_ID);

    const budget = useStore.getState().budget;
    expect(budget.categories.map((c) => c.id)).toEqual([UNCATEGORIZED_CATEGORY_ID]);
    expect(budget.transactions.find((t) => t.id === "t2")?.categoryId).toBe(
      UNCATEGORIZED_CATEGORY_ID,
    );
    // Activity and funding land in the same envelope, so both terms are
    // invariant — nothing vanished and nothing appeared.
    expect(snapshot(budget, "2026-06").readyToAssign).toBe(900);
    expect(snapshot(budget, "2026-06").categories[UNCATEGORIZED_CATEGORY_ID].available).toBe(60);
    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });

  it("returns the assignments of a never-spent envelope to Ready-to-Assign", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addGroup("Bills");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Typo");
    const catId = useStore.getState().budget.categories[0].id;
    s.addTxn({
      id: "t1",
      accountId: "checking",
      date: "2026-06-01",
      amount: 1000,
      categoryId: "rta",
      source: "manual",
    });
    s.assign("2026-06", catId, 100);
    expect(snapshot(useStore.getState().budget, "2026-06").readyToAssign).toBe(900);

    useStore.getState().deleteCategory(catId, UNCATEGORIZED_CATEGORY_ID);

    const budget = useStore.getState().budget;
    // No activity to carry, so there is nothing to keep the funding with: the
    // dollars go back to the pool, and no catch-all envelope is conjured up.
    expect(budget.categories).toEqual([]);
    expect(budget.assignments).toEqual({});
    expect(snapshot(budget, "2026-06").readyToAssign).toBe(1000);
    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });

  it("refuses to delete the Uncategorized envelope", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addTxn({
      id: "t1",
      accountId: "checking",
      date: "2026-06-05",
      amount: -25,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "manual",
    });
    // Saving into it is what created it.
    expect(
      useStore.getState().budget.categories.map((c) => c.id),
    ).toEqual([UNCATEGORIZED_CATEGORY_ID]);

    useStore.getState().deleteCategory(UNCATEGORIZED_CATEGORY_ID, "anything");

    const budget = useStore.getState().budget;
    expect(budget.categories.map((c) => c.id)).toEqual([UNCATEGORIZED_CATEGORY_ID]);
    expect(budget.transactions.find((t) => t.id === "t1")?.categoryId).toBe(
      UNCATEGORIZED_CATEGORY_ID,
    );
    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });
});

describe("undoDeleteCategory (w3-search-undo Finding 4)", () => {
  // Reviewer-verified interleaving: delete Food -> assign 150 to Gas -> add a
  // new transaction on Gas -> Undo. The old restoreBudget (whole pre-delete
  // slice) silently discarded the assignment and the new transaction. The
  // inverse patch must leave both intact while still restoring Food and
  // conserving total assigned dollars (drift stays 0).
  it("survives a budget edit and a new transaction made during the undo window", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addGroup("Envelopes");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Food");
    s.addCategory(groupId, "Gas");
    const foodId = useStore.getState().budget.categories[0].id;
    const gasId = useStore.getState().budget.categories[1].id;
    s.addTxn({
      id: "income",
      accountId: "checking",
      date: "2026-06-01",
      amount: 100_000,
      categoryId: "rta",
      source: "manual",
    });
    s.addTxn({
      id: "grocery",
      accountId: "checking",
      date: "2026-06-05",
      amount: -4000,
      categoryId: foodId,
      source: "manual",
    });
    s.assign("2026-06", foodId, 10_000);
    expect(bookIntegrity(useStore.getState().budget, "2026-06").drift).toBe(0);

    // Delete Food -> its activity and assignment merge onto Gas.
    const patch = useStore.getState().deleteCategory(foodId, gasId);
    expect(patch).not.toBeNull();
    expect(useStore.getState().budget.assignments["2026-06"]?.[gasId]).toBe(10_000);
    expect(bookIntegrity(useStore.getState().budget, "2026-06").drift).toBe(0);

    // Inside the 5s undo window: an explicit re-assign of Gas (an absolute
    // set, not additive) and a brand-new transaction on Gas.
    s.assign("2026-06", gasId, 15_000);
    s.addTxn({
      id: "fuel",
      accountId: "checking",
      date: "2026-06-06",
      amount: -3000,
      categoryId: gasId,
      source: "manual",
    });
    expect(bookIntegrity(useStore.getState().budget, "2026-06").drift).toBe(0);

    useStore.getState().undoDeleteCategory(patch!);

    const budget = useStore.getState().budget;
    // Food is back, and the transaction it originally carried moved back
    // with it — that transaction was never touched during the window, so
    // reclaiming it is safe.
    expect(budget.categories.map((c) => c.id)).toContain(foodId);
    expect(budget.transactions.find((t) => t.id === "grocery")?.categoryId).toBe(foodId);
    expect(budget.assignments["2026-06"]?.[foodId]).toBe(10_000);

    // Gas's assignment survives the undo AT THE USER'S VALUE: they typed an
    // absolute 15,000 over the merged 10,000, so the merge has already been
    // overwritten and there is nothing to unwind — undo keeps 15,000 rather
    // than subtracting the merge back out (which would preserve their delta,
    // not their assignment; Wave 3 recheck F4).
    expect(budget.assignments["2026-06"]?.[gasId]).toBe(15_000);
    // The new transaction added during the window survives untouched.
    expect(budget.transactions.find((t) => t.id === "fuel")?.categoryId).toBe(gasId);

    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });

  it("never mints a negative assignment when the window edit is smaller than the merge", () => {
    // The reviewer's sign-flip repro: Food $200 with activity, Gas empty.
    // Delete merges 20,000 onto Gas; user types an absolute 15,000; blind
    // subtraction would undo Gas to −5,000 — a value assign() can't produce,
    // rendering as phantom overspend that sweeps RTA next month.
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addGroup("Envelopes");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Food");
    s.addCategory(groupId, "Gas");
    const foodId = useStore.getState().budget.categories[0].id;
    const gasId = useStore.getState().budget.categories[1].id;
    s.addTxn({
      id: "income",
      accountId: "checking",
      date: "2026-06-01",
      amount: 100_000,
      categoryId: "rta",
      source: "manual",
    });
    s.addTxn({
      id: "grocery",
      accountId: "checking",
      date: "2026-06-05",
      amount: -4000,
      categoryId: foodId,
      source: "manual",
    });
    s.assign("2026-06", foodId, 20_000);

    const patch = useStore.getState().deleteCategory(foodId, gasId);
    expect(useStore.getState().budget.assignments["2026-06"]?.[gasId]).toBe(20_000);
    s.assign("2026-06", gasId, 15_000);

    useStore.getState().undoDeleteCategory(patch!);

    const budget = useStore.getState().budget;
    expect(budget.assignments["2026-06"]?.[foodId]).toBe(20_000);
    expect(budget.assignments["2026-06"]?.[gasId]).toBe(15_000);
    // No negative assignment anywhere — the state assign() can't produce
    // must not be producible by undo either.
    for (const table of Object.values(budget.assignments)) {
      for (const v of Object.values(table)) expect(v).toBeGreaterThan(0);
    }
    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });

  it("is an exact inversion when nothing was touched during the window", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addGroup("Envelopes");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Food");
    s.addCategory(groupId, "Gas");
    const foodId = useStore.getState().budget.categories[0].id;
    const gasId = useStore.getState().budget.categories[1].id;
    s.addTxn({
      id: "grocery",
      accountId: "checking",
      date: "2026-06-05",
      amount: -4000,
      categoryId: foodId,
      source: "manual",
    });
    s.assign("2026-06", foodId, 10_000);
    const before = useStore.getState().budget;

    const patch = useStore.getState().deleteCategory(foodId, gasId);
    useStore.getState().undoDeleteCategory(patch!);

    const after = useStore.getState().budget;
    expect(after.assignments).toEqual(before.assignments);
    expect(after.categories.map((c) => c.id).sort()).toEqual(
      before.categories.map((c) => c.id).sort(),
    );
    expect(after.transactions.find((t) => t.id === "grocery")?.categoryId).toBe(foodId);
    expect(bookIntegrity(after, "2026-06").drift).toBe(0);
  });

  it("leaves a transaction alone if it was recategorized again during the undo window", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addGroup("Envelopes");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Food");
    s.addCategory(groupId, "Gas");
    s.addCategory(groupId, "Fun");
    const foodId = useStore.getState().budget.categories[0].id;
    const gasId = useStore.getState().budget.categories[1].id;
    const funId = useStore.getState().budget.categories[2].id;
    s.addTxn({
      id: "income",
      accountId: "checking",
      date: "2026-06-01",
      amount: 100_000,
      categoryId: "rta",
      source: "manual",
    });
    s.addTxn({
      id: "grocery",
      accountId: "checking",
      date: "2026-06-05",
      amount: -4000,
      categoryId: foodId,
      source: "manual",
    });

    const patch = useStore.getState().deleteCategory(foodId, gasId);
    expect(patch).not.toBeNull();
    // The user notices the txn landed on Gas and moves it to Fun before
    // tapping Undo.
    s.updateTxn({
      id: "grocery",
      accountId: "checking",
      date: "2026-06-05",
      amount: -4000,
      categoryId: funId,
      source: "manual",
    });

    useStore.getState().undoDeleteCategory(patch!);

    // Undo doesn't clobber the user's more recent choice.
    expect(useStore.getState().budget.transactions.find((t) => t.id === "grocery")?.categoryId).toBe(
      funId,
    );
    expect(bookIntegrity(useStore.getState().budget, "2026-06").drift).toBe(0);
  });
});

describe("updateTxn", () => {
  it("corrects an amount in place: same id, same row count, no drift", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addTxn({
      id: "t1",
      accountId: "checking",
      date: "2026-06-05",
      payee: "Grocery store",
      amount: -40,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "manual",
    });

    useStore.getState().updateTxn({
      id: "t1",
      accountId: "checking",
      date: "2026-06-05",
      payee: "Grocery store",
      amount: -55,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "manual",
    });

    const budget = useStore.getState().budget;
    expect(budget.transactions).toHaveLength(1);
    expect(budget.transactions[0].id).toBe("t1");
    expect(budget.transactions[0].amount).toBe(-55);
    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });

  it("materializes the catch-all envelope when an edit retargets a row onto it", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addGroup("Bills");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Phone");
    const catId = useStore.getState().budget.categories[0].id;
    s.addTxn({
      id: "t1",
      accountId: "checking",
      date: "2026-06-05",
      amount: -40,
      categoryId: catId,
      source: "manual",
    });
    // Never touched the catch-all before this edit.
    expect(
      useStore.getState().budget.categories.map((c) => c.id),
    ).toEqual([catId]);

    useStore.getState().updateTxn({
      id: "t1",
      accountId: "checking",
      date: "2026-06-05",
      amount: -40,
      categoryId: UNCATEGORIZED_CATEGORY_ID,
      source: "manual",
    });

    const budget = useStore.getState().budget;
    expect(budget.categories.map((c) => c.id)).toContain(UNCATEGORIZED_CATEGORY_ID);
    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });
});

describe("addTransfer", () => {
  it("materializes the catch-all envelope for a cross-boundary transfer", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addAccount({ id: "brokerage", name: "Brokerage", kind: "tracking", source: "manual" });
    s.addTxn({
      id: "t1",
      accountId: "checking",
      date: "2026-06-01",
      amount: 1000,
      categoryId: "rta",
      source: "manual",
    });
    // A book that has never touched the catch-all.
    expect(useStore.getState().budget.categories).toEqual([]);

    useStore.getState().addTransfer({
      from: "checking",
      to: "brokerage",
      amount: 500,
      date: "2026-06-05",
      categoryId: UNCATEGORIZED_CATEGORY_ID,
    });

    const budget = useStore.getState().budget;
    // The row the on-budget leg points at now exists, so the −500 envelope is
    // rendered rather than only computed — no silent sweep into next month's
    // Ready to Assign.
    const category = budget.categories.find((c) => c.id === UNCATEGORIZED_CATEGORY_ID);
    expect(category?.name).toBe("Uncategorized");
    expect(category?.nodeId).toBeUndefined();
    expect(budget.groups.some((g) => g.id === "g:system")).toBe(true);
    expect(snapshot(budget, "2026-06").categories[UNCATEGORIZED_CATEGORY_ID].available).toBe(
      -500,
    );
    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });

  it("conjures no envelope for a same-side transfer", () => {
    const s = useStore.getState();
    s.reset();
    s.addAccount({ id: "checking", name: "Checking", kind: "checking", source: "manual" });
    s.addAccount({ id: "savings", name: "Savings", kind: "savings", source: "manual" });
    // pairTransfer strips the category from an on→on pair, so there is no id
    // to honour and no row the user never asked for.
    useStore.getState().addTransfer({
      from: "checking",
      to: "savings",
      amount: 200,
      date: "2026-06-05",
      categoryId: UNCATEGORIZED_CATEGORY_ID,
    });

    const budget = useStore.getState().budget;
    expect(budget.categories).toEqual([]);
    expect(budget.groups).toEqual([]);
    expect(budget.transactions.every((t) => t.categoryId === undefined)).toBe(true);
    expect(bookIntegrity(budget, "2026-06").drift).toBe(0);
  });
});

describe("applyBookOps", () => {
  it("applies a balance-edit plan atomically through the store", () => {
    const s = useStore.getState();
    s.reset();
    const month = ymKey();
    s.addGroup("Emergency Fund");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Medical");
    const catId = useStore.getState().budget.categories[0].id;
    s.assign(month, catId, 100);

    // Lower past the assignment: un-assign + one coalesced adjustment txn.
    const book = useStore.getState().budget;
    s.applyBookOps(planBalanceEdit(book, month, catId, -25, `${month}-10`));

    const after = useStore.getState().budget;
    expect(after.assignments[month]?.[catId]).toBeUndefined();
    const adjustments = after.transactions.filter((t) => t.accountId === ADJUST_ACCOUNT_ID);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount).toBe(-25);
    expect(after.accounts.some((a) => a.id === ADJUST_ACCOUNT_ID)).toBe(true);
    expect(snapshot(after, month).categories[catId].available).toBe(-25);
    expect(bookIntegrity(after, month).drift).toBe(0);
  });

  it("correcting the balance a day later unwinds the write-off, leaving RTA whole", () => {
    const s = useStore.getState();
    s.reset();
    const month = ymKey();
    s.addGroup("Emergency Fund");
    const groupId = useStore.getState().budget.groups[0].id;
    s.addCategory(groupId, "Medical");
    const catId = useStore.getState().budget.categories[0].id;
    s.assign(month, catId, 100);

    const before = useStore.getState().budget;
    const rtaBefore = snapshot(before, month).readyToAssign;

    // Day 10 typo: available driven below zero, writing off 25 dollars.
    s.applyBookOps(planBalanceEdit(before, month, catId, -25, `${month}-10`));
    // Day 11 correction back to where it started.
    s.applyBookOps(planBalanceEdit(useStore.getState().budget, month, catId, 100, `${month}-11`));

    const after = useStore.getState().budget;
    expect(after.transactions.filter((t) => t.accountId === ADJUST_ACCOUNT_ID)).toHaveLength(0);
    expect(after.assignments).toEqual(before.assignments);
    const snap = snapshot(after, month);
    expect(snap.categories[catId].available).toBe(100);
    expect(snap.readyToAssign).toBe(rtaBefore);
    expect(bookIntegrity(after, month).drift).toBe(0);
  });
});
