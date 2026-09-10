import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeInitialState } from "./schema";

// F12: multi-tab last-writer-wins. store.ts's module-level persistence
// state (the writeSeq counter, the `storage` listener, the suspended
// subscription) must be exercised fresh per test — same rationale as
// boot.test.ts's module reset, and doubly so here because suspending
// persistence is a one-way trip for the module instance that does it.
const KEY = "financeflow:state:v1";

function dispatchStorage(newValue: string | null): void {
  window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue }));
}

describe("multi-tab write guard (F12)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("suspends saving and surfaces a blocking banner when another window's writeSeq is ahead", async () => {
    const { useStore, flushSave, adapter } = await import("./store");
    const { useUI } = await import("./uiStore");

    // Establish this tab's own baseline so its writeSeq counter is known
    // (fresh module against empty localStorage boots at writeSeq 0).
    useStore.getState().setNotes("Start", "hello");
    flushSave();
    expect(useUI.getState().staleTab).toBeNull();

    const spy = vi.spyOn(adapter, "save");
    spy.mockClear();

    // Another tab/window (or the installed PWA) persisted a document with a
    // writeSeq ahead of what this tab has ever written.
    const newerDoc = { ...makeInitialState(), writeSeq: 99 };
    dispatchStorage(JSON.stringify(newerDoc));

    expect(useUI.getState().staleTab).toMatch(/reload/i);

    // Suspended: this tab's own further mutations must never reach
    // localStorage again, even past what would have been the debounce
    // window (subscription is unsubscribed, not just the pending write
    // cleared, so scheduleSave never even runs).
    useStore.getState().setNotes("Start", "should not persist");
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();

    // A pagehide-style flush afterward must respect the suspension too.
    flushSave();
    expect(spy).not.toHaveBeenCalled();
  });

  it("a normal same-tab save sequence does not trip the guard", async () => {
    const { useStore, flushSave, adapter } = await import("./store");
    const { useUI } = await import("./uiStore");
    const spy = vi.spyOn(adapter, "save");

    useStore.getState().setNotes("Start", "first");
    flushSave();
    useStore.getState().setNotes("Start", "second");
    flushSave();
    useStore.getState().setNotes("Start", "third");
    flushSave();

    // Same-tab writes never dispatch a `storage` event in a real browser
    // (only *other* browsing contexts receive it), so a normal debounced
    // save sequence — with no cross-tab event at all — must never trip the
    // guard on its own.
    expect(useUI.getState().staleTab).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("ignores a storage event whose writeSeq is not ahead of this tab's own", async () => {
    const { useStore, flushSave, adapter } = await import("./store");
    const { useUI } = await import("./uiStore");

    useStore.getState().setNotes("Start", "hello");
    flushSave(); // this tab is now at writeSeq 1

    const spy = vi.spyOn(adapter, "save");
    spy.mockClear();

    const sameSeqDoc = { ...makeInitialState(), writeSeq: 1 };
    dispatchStorage(JSON.stringify(sameSeqDoc));
    expect(useUI.getState().staleTab).toBeNull();

    // Saving must still work normally afterward.
    useStore.getState().setNotes("Start", "still saving");
    flushSave();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("tolerates a stored document with no writeSeq at all (pre-F12 documents)", async () => {
    const { useStore, flushSave, adapter } = await import("./store");
    const { useUI } = await import("./uiStore");

    useStore.getState().setNotes("Start", "hello");
    flushSave();

    const spy = vi.spyOn(adapter, "save");
    spy.mockClear();

    dispatchStorage(JSON.stringify(makeInitialState())); // no writeSeq field
    expect(useUI.getState().staleTab).toBeNull();

    useStore.getState().setNotes("Start", "still saving");
    flushSave();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("ignores storage events for unrelated keys", async () => {
    const { useStore, flushSave, adapter } = await import("./store");
    const { useUI } = await import("./uiStore");

    useStore.getState().setNotes("Start", "hello");
    flushSave();

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "some-other-app:key",
        newValue: JSON.stringify({ writeSeq: 999 }),
      }),
    );
    expect(useUI.getState().staleTab).toBeNull();

    const spy = vi.spyOn(adapter, "save");
    spy.mockClear();
    useStore.getState().setNotes("Start", "still saving");
    flushSave();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
