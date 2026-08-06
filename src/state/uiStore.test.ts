import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapter, flushSave, useStore } from "./store";
import { applyPwaUpdate, setPwaUpdateHandler } from "./uiStore";

// F13: applyPwaUpdate() is the one reload the app triggers itself, so any
// still-pending debounced save must be flushed before the service worker
// takes over — not left to visibilitychange/pagehide, which this code path
// has no guarantee fires first on every platform.
describe("applyPwaUpdate flushes pending saves (F13)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.getState().reset();
    // Prime the debounce baseline so reset() itself doesn't count as a
    // pending write the tests below are asserting about.
    flushSave();
  });

  afterEach(() => {
    vi.advanceTimersByTime(1000); // drain any leftover debounce timer
    vi.useRealTimers();
    vi.restoreAllMocks();
    useStore.getState().reset();
  });

  it("writes the pending debounced save synchronously before invoking the SW update", () => {
    const saveSpy = vi.spyOn(adapter, "save");
    useStore.getState().setNotes("Start", "not yet saved");
    expect(saveSpy).not.toHaveBeenCalled();

    const updateFn = vi.fn(async () => {});
    setPwaUpdateHandler(updateFn);

    applyPwaUpdate();

    // The write already happened by the time applyPwaUpdate() returns —
    // nothing was left to the debounce timer or to visibilitychange/pagehide.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0].nodes.Start.notes).toBe("not yet saved");
    expect(updateFn).toHaveBeenCalledWith(true);

    vi.advanceTimersByTime(1000);
    expect(saveSpy).toHaveBeenCalledTimes(1); // no duplicate write later
  });

  it("is a no-op save when there was nothing pending", () => {
    const saveSpy = vi.spyOn(adapter, "save");
    const updateFn = vi.fn(async () => {});
    setPwaUpdateHandler(updateFn);

    applyPwaUpdate();

    expect(saveSpy).not.toHaveBeenCalled();
    expect(updateFn).toHaveBeenCalledWith(true);
  });
});
