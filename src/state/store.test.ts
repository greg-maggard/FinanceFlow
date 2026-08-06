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
