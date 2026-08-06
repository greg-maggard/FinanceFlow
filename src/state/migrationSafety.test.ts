import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failWritesTo, restoreStorage } from "../test/quotaStorage";

// The boot path's migration gate, exercised through the real store module
// (loadInitial runs at module init, so each test needs a fresh module registry
// with localStorage seeded first — same pattern as boot.test.ts).
const KEY = "financeflow:state:v1";
const PREMIGRATION_KEY = "financeflow:premigration:v3";
const ROLLING_KEY = "financeflow:backup:v3";

/** Structurally valid v3, in dollars, with enough in it to be worth losing. */
function v3Doc(marker: string) {
  return {
    version: 3,
    settings: { iraAnnualLimit: 7000, hsaSelfLimit: 4300, hsaFamilyLimit: 8550 },
    decisions: {},
    nodes: { Start: { completed: false, notes: marker } },
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
}

describe("a failed pre-migration backup blocks the migration (F2)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    restoreStorage();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("surfaces the block and leaves the live v3 bytes byte-for-byte intact", async () => {
    const raw = JSON.stringify(v3Doc("irreplaceable"));
    localStorage.setItem(KEY, raw);
    failWritesTo(/^financeflow:premigration:/);

    const { getBootRecovery, useStore } = await import("./store");

    // The block is surfaced, not swallowed: App.tsx renders RecoveryScreen for
    // a non-null bootRecovery, and hands `raw` to "Download my data" — the
    // still-intact original bytes, which is the whole point of blocking.
    const recovery = getBootRecovery();
    expect(recovery).not.toBeNull();
    expect(recovery!.raw).toBe(raw);
    expect(recovery!.message).toMatch(/storage is full/i);
    expect(recovery!.message).toMatch(/NOT been changed/);

    // In-memory state is the throwaway fresh one, for rendering only.
    expect(useStore.getState().version).toBe(4);

    // And the stored document is untouched — immediately, and past the
    // debounce window in which the old code wrote the v4 image over it.
    expect(localStorage.getItem(KEY)).toBe(raw);
    await new Promise((r) => setTimeout(r, 400));
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(JSON.parse(localStorage.getItem(KEY)!).version).toBe(3);
  });

  it("keeps persistence suspended, so later mutations can't overwrite the v3 bytes either", async () => {
    const raw = JSON.stringify(v3Doc("still here"));
    localStorage.setItem(KEY, raw);
    failWritesTo(/^financeflow:premigration:/);

    const { useStore, flushSave } = await import("./store");

    useStore.getState().setNotes("Start", "a mutation after the blocked boot");
    flushSave();
    await new Promise((r) => setTimeout(r, 400));

    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it("migrates normally once the backup write succeeds", async () => {
    const raw = JSON.stringify(v3Doc("ordinary boot"));
    localStorage.setItem(KEY, raw);

    const { getBootRecovery, useStore, flushSave } = await import("./store");

    expect(getBootRecovery()).toBeNull();
    expect(useStore.getState().version).toBe(4);
    expect(JSON.parse(localStorage.getItem(PREMIGRATION_KEY)!).raw).toBe(raw);

    useStore.getState().setNotes("Start", "edited");
    flushSave();
    expect(JSON.parse(localStorage.getItem(KEY)!).version).toBe(4);
  });
});

describe("the pre-migration backup has its own slot (F3)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00.000Z"));
  });

  afterEach(() => {
    restoreStorage();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  // The starvation scenario: a rolling promotion fired 60s before the upgrade,
  // so the shared `financeflow:backup:v3` slot was already occupied and
  // never-clobber discarded the pre-migration bytes — leaving the D7 net
  // holding a document up to 24h stale at the one moment it matters.
  it("captures the bytes at the instant of migration even with a rolling backup 60s old", async () => {
    const stale = JSON.stringify(v3Doc("yesterday's document"));
    const atMigration = JSON.stringify(v3Doc("what was actually there when we upgraded"));

    const rollingEnvelope = JSON.stringify({ at: Date.now() - 60_000, raw: stale });
    localStorage.setItem(ROLLING_KEY, rollingEnvelope);
    localStorage.setItem(KEY, atMigration);

    const { getBootRecovery, useStore } = await import("./store");
    const { readLatestBackup } = await import("./storage");

    expect(getBootRecovery()).toBeNull();
    expect(useStore.getState().version).toBe(4);
    // The migration that was allowed to proceed produced a balanced book.
    const { bookIntegrity } = await import("../budget/ledger");
    expect(bookIntegrity(useStore.getState().budget, "2026-06").drift).toBe(0);

    // The pre-migration bytes are parked, exactly as read.
    expect(JSON.parse(localStorage.getItem(PREMIGRATION_KEY)!).raw).toBe(atMigration);
    // The rolling slot is left entirely to its own mechanism.
    expect(localStorage.getItem(ROLLING_KEY)).toBe(rollingEnvelope);
    // And recovery offers the fresher of the two — the one being migrated,
    // not yesterday's.
    expect(readLatestBackup()!.raw).toBe(atMigration);
  });
});
