import { describe, expect, it } from "vitest";
import { useStore } from "./store";
import { snapshot } from "../budget/ledger";

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
