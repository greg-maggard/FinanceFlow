import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeInitialState } from "./schema";

// loadInitial() runs once at module init, so exercising both outcomes
// requires a fresh module registry per test with localStorage seeded first.
const KEY = "financeflow:state:v1";

/** A minimal but structurally valid v3 document, in dollars. */
const V3_DOC = {
  version: 3,
  settings: { iraAnnualLimit: 7000, hsaSelfLimit: 4300, hsaFamilyLimit: 8550 },
  decisions: {},
  nodes: {},
  budget: { accounts: [], transactions: [], groups: [], categories: [], assignments: {} },
};

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
    expect(useStore.getState().version).toBe(4);

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

  it("boots straight into the app for a normal v4 document", async () => {
    const state = makeInitialState();
    const raw = JSON.stringify(state);
    localStorage.setItem(KEY, raw);

    const { getBootRecovery, useStore } = await import("./store");

    expect(getBootRecovery()).toBeNull();
    expect(useStore.getState().version).toBe(4);
  });

  it("boots fresh with no recovery when nothing is stored", async () => {
    const { getBootRecovery, useStore } = await import("./store");

    expect(getBootRecovery()).toBeNull();
    expect(useStore.getState().version).toBe(4);
  });

  // F10: migrate() used to cast any current-version document unvalidated, so
  // these two cases booted straight into AppShell — case A with an active
  // persistence subscription that overwrote the stored bytes on the first
  // mutation, case B with a white screen (snapshot() throwing on a missing
  // budget.assignments) and no recovery route at all. Both must now land on
  // the recovery path, with the original bytes left untouched.
  // D7 (money-migration-v4.md): opening a v3 document upgrades it in place and
  // the debounced write replaces the stored bytes with the v4 image. The
  // ORIGINAL bytes must be parked under their own version key first, or a bad
  // migration is unrecoverable from inside the app.
  it("stashes the pre-migration bytes under financeflow:backup:v3 before upgrading", async () => {
    const v3 = {
      version: 3,
      settings: { iraAnnualLimit: 7000, hsaSelfLimit: 4300, hsaFamilyLimit: 8550 },
      decisions: {},
      nodes: {},
      budget: {
        accounts: [{ id: "checking", name: "Checking", kind: "checking", source: "manual" }],
        transactions: [
          { id: "t1", accountId: "checking", date: "2026-06-01", amount: 12.34, source: "manual" },
        ],
        groups: [],
        categories: [],
        assignments: {},
      },
    };
    const raw = JSON.stringify(v3);
    localStorage.setItem(KEY, raw);

    const { getBootRecovery, useStore } = await import("./store");

    expect(getBootRecovery()).toBeNull();
    expect(useStore.getState().version).toBe(4);
    // Byte-for-byte the document that was there before the upgrade ran.
    const envelope = JSON.parse(localStorage.getItem("financeflow:backup:v3")!);
    expect(envelope.raw).toBe(raw);
  });

  it("never clobbers an existing pre-migration backup", async () => {
    const older = JSON.stringify({ at: 1, raw: '{"version":3,"note":"the one to keep"}' });
    localStorage.setItem("financeflow:backup:v3", older);
    localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(JSON.stringify(V3_DOC)) }));

    await import("./store");

    expect(localStorage.getItem("financeflow:backup:v3")).toBe(older);
  });

  it("F10 case A: routes a bare {version:4} document to recovery, not a silent boot", async () => {
    const raw = JSON.stringify({ version: 4 });
    localStorage.setItem(KEY, raw);

    const { getBootRecovery } = await import("./store");

    const recovery = getBootRecovery();
    expect(recovery).not.toBeNull();
    expect(recovery?.raw).toBe(raw);

    expect(localStorage.getItem(KEY)).toBe(raw);
    // Past the debounce window too: no store mutation should ever fire here
    // (persistence is suspended), but confirm the bytes survive regardless.
    await new Promise((r) => setTimeout(r, 350));
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it("F10 case B: routes a v4 document missing budget.assignments to recovery", async () => {
    const state = makeInitialState() as any;
    delete state.budget.assignments;
    const raw = JSON.stringify(state);
    localStorage.setItem(KEY, raw);

    const { getBootRecovery, useStore } = await import("./store");

    const recovery = getBootRecovery();
    expect(recovery).not.toBeNull();
    expect(recovery?.raw).toBe(raw);
    expect(recovery?.message).toMatch(/assignments/i);

    // Falls back to a throwaway fresh state for rendering, same as the other
    // recovery cases — but critically the stored bytes are untouched.
    expect(useStore.getState().version).toBe(4);
    expect(localStorage.getItem(KEY)).toBe(raw);
    await new Promise((r) => setTimeout(r, 350));
    expect(localStorage.getItem(KEY)).toBe(raw);
  });
});
