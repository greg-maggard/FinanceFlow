import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// w3-backup-key: exercises the real writeNow() path in store.ts, not just
// storage.ts's pure helpers -- proves the store actually wires
// maybePromoteBackup() into every persistence write, with the right bytes
// (the previous live document, not the one about to be written) and the
// right timing (fresh module registry per test, same rationale as
// multiTab.test.ts: store.ts's module-level writeSeq/lastSaved state is not
// meant to be exercised across tests). The key is version-derived, so a fresh
// (v4) document promotes under the v4 key -- see storage.ts.
const BACKUP_KEY = "financeflow:backup:v4";

describe("rolling backup key wired into the persistence write path (w3-backup-key)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates no backup on the very first write -- nothing live yet to protect", async () => {
    const { useStore, flushSave } = await import("./store");
    useStore.getState().setNotes("Start", "first ever save");
    flushSave();
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  it("promotes the prior write's bytes on the next write, then holds steady inside 24h", async () => {
    const { useStore, flushSave } = await import("./store");

    useStore.getState().setNotes("Start", "day 1 content");
    flushSave(); // nothing to back up yet (first-ever write)

    useStore.getState().setNotes("Start", "day 1 content, revised");
    flushSave(); // promotes the "day 1 content" bytes just written above

    const envelope1 = JSON.parse(localStorage.getItem(BACKUP_KEY)!);
    expect(JSON.parse(envelope1.raw).nodes.Start.notes).toBe("day 1 content");

    // An hour later, still inside the 24h window: must not re-promote.
    vi.setSystemTime(new Date("2026-08-01T01:00:00.000Z"));
    useStore.getState().setNotes("Start", "same day, later edit");
    flushSave();

    const envelope2 = JSON.parse(localStorage.getItem(BACKUP_KEY)!);
    expect(envelope2.at).toBe(envelope1.at);
    expect(JSON.parse(envelope2.raw).nodes.Start.notes).toBe("day 1 content");
  });

  it("rolls forward to yesterday's document once 24h have passed, keeping exactly one generation", async () => {
    const { useStore, flushSave } = await import("./store");

    useStore.getState().setNotes("Start", "day 1");
    flushSave();
    useStore.getState().setNotes("Start", "day 1, edited");
    flushSave(); // promotes "day 1"

    vi.setSystemTime(new Date("2026-08-02T01:00:00.000Z")); // >24h after the promotion above
    useStore.getState().setNotes("Start", "day 2");
    flushSave(); // promotes "day 1, edited" -- yesterday's live document

    const envelope = JSON.parse(localStorage.getItem(BACKUP_KEY)!);
    expect(JSON.parse(envelope.raw).nodes.Start.notes).toBe("day 1, edited");

    const backupKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("financeflow:backup:")) backupKeys.push(k);
    }
    expect(backupKeys).toEqual([BACKUP_KEY]);
  });

  it("readLatestBackup() reflects what the store just promoted, ready for RecoveryScreen/Settings", async () => {
    const { useStore, flushSave } = await import("./store");
    const { readLatestBackup } = await import("./storage");

    expect(readLatestBackup()).toBeNull();

    useStore.getState().setNotes("Start", "v1");
    flushSave();
    useStore.getState().setNotes("Start", "v2");
    flushSave();

    const backup = readLatestBackup();
    expect(backup).not.toBeNull();
    expect(JSON.parse(backup!.raw).nodes.Start.notes).toBe("v1");
  });
});
