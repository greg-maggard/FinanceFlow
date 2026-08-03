import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapter, flushSave, useStore } from "./store";
import { snapshot } from "../budget/ledger";
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
  });
});

describe("deleteCategory", () => {
  it("uncategorizes its transactions and returns its assignments to RTA", () => {
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

    useStore.getState().deleteCategory(catId);

    const budget = useStore.getState().budget;
    expect(budget.categories).toEqual([]);
    expect(budget.transactions.find((t) => t.id === "t2")?.categoryId).toBeUndefined();
    expect(budget.assignments).toEqual({});
    // The deleted envelope's dollars are back in the pool — nothing vanished.
    expect(snapshot(budget, "2026-06").readyToAssign).toBe(1000);
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
  });
});
