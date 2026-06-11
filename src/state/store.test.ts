import { describe, expect, it } from "vitest";
import { useStore } from "./store";
import { snapshot } from "../budget/ledger";
import { ADJUST_ACCOUNT_ID, planBalanceEdit } from "../budget/nodeLedger";
import { ymKey } from "./recurring";

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
    useStore.getState().reset();
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
    s.applyBookOps(planBalanceEdit(book, month, catId, -25, "2026-06-10"));

    const after = useStore.getState().budget;
    expect(after.assignments[month]?.[catId]).toBeUndefined();
    const adjustments = after.transactions.filter((t) => t.accountId === ADJUST_ACCOUNT_ID);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].amount).toBe(-25);
    expect(after.accounts.some((a) => a.id === ADJUST_ACCOUNT_ID)).toBe(true);
    expect(snapshot(after, month).categories[catId].available).toBe(-25);
    useStore.getState().reset();
  });
});
