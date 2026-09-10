import { beforeEach, describe, expect, it, vi } from "vitest";

// view/focusedId are read once at module init and written on every change
// via a subscribe callback, so exercising the read side needs a fresh
// module registry per test with localStorage seeded first (same pattern as
// boot.test.ts for store.ts's loadInitial()).
const UI_KEY = "financeflow:ui:v1";

describe("uiStore view/focusedId persistence (w2-persist-view)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("first-ever launch (nothing persisted) defaults to the Budget screen", async () => {
    const { useUI } = await import("./uiStore");
    expect(useUI.getState().view).toBe("budget");
    expect(useUI.getState().focusedId).toBeNull();
  });

  it("coerces a persisted 'overview' view to Budget on load (w2-persist-view finding 6): overview is a transient overlay, not a landing view, and restoring it would silently break the Today strip's 0-tap promise", async () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ view: "overview", focusedId: "Rent" }));

    const { useUI } = await import("./uiStore");

    expect(useUI.getState().view).toBe("budget");
    // focusedId (last-focused-node) still restores even though view didn't.
    expect(useUI.getState().focusedId).toBe("Rent");
  });

  it("coerces a persisted 'shelf' view to Budget on load: shelf has no renderer anywhere", async () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ view: "shelf", focusedId: null }));

    const { useUI } = await import("./uiStore");

    expect(useUI.getState().view).toBe("budget");
  });

  it("restores a persisted focus-view session with its focused node", async () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ view: "focus", focusedId: "Food" }));

    const { useUI } = await import("./uiStore");

    expect(useUI.getState().view).toBe("focus");
    expect(useUI.getState().focusedId).toBe("Food");
  });

  it("writes view and focusedId to their own key on change, separate from the budget document", async () => {
    const { useUI } = await import("./uiStore");

    useUI.getState().setView("focus");

    expect(JSON.parse(localStorage.getItem(UI_KEY)!)).toEqual({
      view: "focus",
      focusedId: null,
    });
  });

  it("does not persist a transient 'overview' view — the last restorable (focus/budget) view stays on disk instead (w2-persist-view finding 6)", async () => {
    const { useUI } = await import("./uiStore");

    useUI.getState().setView("focus");
    useUI.getState().setView("overview");

    expect(JSON.parse(localStorage.getItem(UI_KEY)!)).toEqual({
      view: "focus",
      focusedId: null,
    });
    // The live in-memory view is still "overview" — only the persisted copy
    // is pinned to the last restorable view.
    expect(useUI.getState().view).toBe("overview");
  });

  it("does not persist one-shot signals (pendingCelebration, pendingMedal, budgetFocus, direction)", async () => {
    const { useUI } = await import("./uiStore");

    useUI.getState().triggerCelebration("Rent", true);
    useUI.getState().triggerMedal(2);
    useUI.getState().openInBudget({ categoryId: "cat-1" });
    useUI.getState().setFocus("Food", "forward");

    const persisted = JSON.parse(localStorage.getItem(UI_KEY)!);
    expect(Object.keys(persisted).sort()).toEqual(["focusedId", "view"]);
  });

  it("falls back to defaults instead of crashing on corrupt persisted JSON", async () => {
    localStorage.setItem(UI_KEY, "{not json");

    const { useUI } = await import("./uiStore");

    expect(useUI.getState().view).toBe("budget");
    expect(useUI.getState().focusedId).toBeNull();
  });

  it("ignores a persisted view value outside the known ViewMode set", async () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ view: "not-a-real-view", focusedId: null }));

    const { useUI } = await import("./uiStore");

    expect(useUI.getState().view).toBe("budget");
  });
});

// w2-fastentry: the FAB's account/category memory rides the same UI key as
// view/focusedId above, so it needs the same fresh-module-per-test treatment.
describe("uiStore lastUsedTxn persistence (w2-fastentry)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("is null on first-ever launch", async () => {
    const { useUI } = await import("./uiStore");
    expect(useUI.getState().lastUsedTxn).toBeNull();
  });

  it("restores a persisted lastUsedTxn on load", async () => {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({
        view: "budget",
        focusedId: null,
        lastUsedTxn: { accountId: "checking", categoryByAccount: { checking: "cat:coffee" } },
      }),
    );

    const { useUI } = await import("./uiStore");

    expect(useUI.getState().lastUsedTxn).toEqual({
      accountId: "checking",
      categoryByAccount: { checking: "cat:coffee" },
    });
  });

  it("writes lastUsedTxn to the shared UI key, keyed per account, on recordTxnUsage", async () => {
    const { useUI } = await import("./uiStore");

    useUI.getState().recordTxnUsage("checking", "cat:coffee");
    expect(JSON.parse(localStorage.getItem(UI_KEY)!)).toEqual({
      view: "budget",
      focusedId: null,
      lastUsedTxn: { accountId: "checking", categoryByAccount: { checking: "cat:coffee" } },
    });

    // A different account gets its own remembered category, without
    // clobbering the first account's.
    useUI.getState().recordTxnUsage("savings", "cat:groceries");
    expect(useUI.getState().lastUsedTxn).toEqual({
      accountId: "savings",
      categoryByAccount: { checking: "cat:coffee", savings: "cat:groceries" },
    });

    // Logging against "checking" again overwrites only that account's entry.
    useUI.getState().recordTxnUsage("checking", "cat:transport");
    expect(useUI.getState().lastUsedTxn).toEqual({
      accountId: "checking",
      categoryByAccount: { checking: "cat:transport", savings: "cat:groceries" },
    });
  });

  it("falls back to null instead of crashing on a malformed persisted lastUsedTxn", async () => {
    localStorage.setItem(
      UI_KEY,
      JSON.stringify({ view: "budget", focusedId: null, lastUsedTxn: { accountId: 42 } }),
    );

    const { useUI } = await import("./uiStore");

    expect(useUI.getState().lastUsedTxn).toBeNull();
  });

  it("omits lastUsedTxn from the persisted write while it is still null", async () => {
    const { useUI } = await import("./uiStore");

    useUI.getState().setView("overview");

    expect(Object.keys(JSON.parse(localStorage.getItem(UI_KEY)!)).sort()).toEqual([
      "focusedId",
      "view",
    ]);
  });
});
