import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeInitialState } from "./schema";

// loadInitial() runs once at module init, so exercising both outcomes
// requires a fresh module registry per test with localStorage seeded first.
const KEY = "financeflow:state:v1";

describe("loadInitial recovery (boot path)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("reports recovery instead of resetting when migrate() refuses an unsupported version", async () => {
    const raw = JSON.stringify({ version: 99 });
    localStorage.setItem(KEY, raw);

    const { getBootRecovery, useStore } = await import("./store");

    const recovery = getBootRecovery();
    expect(recovery).not.toBeNull();
    expect(recovery?.raw).toBe(raw);
    expect(recovery?.message).toMatch(/Unsupported FinanceFlow version/);

    // The store still constructs (with a throwaway fresh state for
    // rendering purposes) rather than throwing at module init.
    expect(useStore.getState().version).toBe(3);

    // Critically: the original bytes in localStorage are untouched, both
    // right away and after the debounce window that would otherwise let the
    // persistence subscription overwrite them.
    expect(localStorage.getItem(KEY)).toBe(raw);
    await new Promise((r) => setTimeout(r, 350));
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it("reports recovery when the stored bytes aren't valid JSON", async () => {
    const raw = "{not json";
    localStorage.setItem(KEY, raw);

    const { getBootRecovery } = await import("./store");

    const recovery = getBootRecovery();
    expect(recovery).not.toBeNull();
    expect(recovery?.raw).toBe(raw);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it("boots straight into the app for a normal v3 document", async () => {
    const state = makeInitialState();
    const raw = JSON.stringify(state);
    localStorage.setItem(KEY, raw);

    const { getBootRecovery, useStore } = await import("./store");

    expect(getBootRecovery()).toBeNull();
    expect(useStore.getState().version).toBe(3);
  });

  it("boots fresh with no recovery when nothing is stored", async () => {
    const { getBootRecovery, useStore } = await import("./store");

    expect(getBootRecovery()).toBeNull();
    expect(useStore.getState().version).toBe(3);
  });
});
