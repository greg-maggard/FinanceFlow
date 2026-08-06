import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupPreMigration, maybePromoteBackup, readLatestBackup } from "./storage";
import { failWritesTo, restoreStorage } from "../test/quotaStorage";

// w3-backup-key: pure unit tests for the rolling last-known-good backup.
// `maybePromoteBackup`/`readLatestBackup` take an explicit `now` (backup
// creation) or read whatever's actually in localStorage (backup read), so
// these run without fake timers -- just distinct millisecond values.
const DAY_MS = 24 * 60 * 60 * 1000;

describe("maybePromoteBackup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does nothing when there is no live document to protect yet", () => {
    maybePromoteBackup(null, 1000);
    expect(readLatestBackup()).toBeNull();
  });

  it("does nothing for bytes with no readable version field", () => {
    maybePromoteBackup("{not json", 1000);
    expect(readLatestBackup()).toBeNull();
    maybePromoteBackup(JSON.stringify({ no: "version" }), 1000);
    expect(readLatestBackup()).toBeNull();
  });

  it("promotes to a version-suffixed key parsed from the bytes themselves", () => {
    const raw = JSON.stringify({ version: 3, nodes: { Start: { notes: "hi" } } });
    maybePromoteBackup(raw, 1000);
    expect(localStorage.getItem("financeflow:backup:v3")).not.toBeNull();
    const envelope = JSON.parse(localStorage.getItem("financeflow:backup:v3")!);
    expect(envelope).toEqual({ at: 1000, raw });
  });

  it("skips a re-promotion less than 24h after the last one", () => {
    const first = JSON.stringify({ version: 3, day: 1 });
    const second = JSON.stringify({ version: 3, day: 2 });
    maybePromoteBackup(first, 1000);
    maybePromoteBackup(second, 1000 + DAY_MS - 1);

    const envelope = JSON.parse(localStorage.getItem("financeflow:backup:v3")!);
    expect(envelope).toEqual({ at: 1000, raw: first });
  });

  it("re-promotes once 24h have passed, overwriting rather than accumulating", () => {
    const first = JSON.stringify({ version: 3, day: 1 });
    const second = JSON.stringify({ version: 3, day: 2 });
    maybePromoteBackup(first, 1000);
    maybePromoteBackup(second, 1000 + DAY_MS);

    const envelope = JSON.parse(localStorage.getItem("financeflow:backup:v3")!);
    expect(envelope).toEqual({ at: 1000 + DAY_MS, raw: second });

    // Exactly one generation: still only one financeflow:backup:* key.
    const backupKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("financeflow:backup:")) backupKeys.push(k);
    }
    expect(backupKeys).toEqual(["financeflow:backup:v3"]);
  });

  it("keys a differently-versioned document under its own backup key, untouched by others", () => {
    const v3doc = JSON.stringify({ version: 3, doc: "v3" });
    const v4doc = JSON.stringify({ version: 4, doc: "v4" });
    maybePromoteBackup(v3doc, 1000);
    maybePromoteBackup(v4doc, 1000 + DAY_MS); // different key -> not throttled by v3's promotion

    expect(JSON.parse(localStorage.getItem("financeflow:backup:v3")!).raw).toBe(v3doc);
    expect(JSON.parse(localStorage.getItem("financeflow:backup:v4")!).raw).toBe(v4doc);
  });
});

// The one-shot pre-migration copy. Two properties the rolling backup does not
// have: its own key prefix (so a rolling promotion can't starve it), and a
// reported success/failure (so store.ts can gate the migration on it).
describe("backupPreMigration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    restoreStorage();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("writes under its own premigration prefix, not the rolling backup key", () => {
    const raw = JSON.stringify({ version: 3, doc: "pre-migration" });
    expect(backupPreMigration(3, raw, 1000)).toBe(true);

    expect(JSON.parse(localStorage.getItem("financeflow:premigration:v3")!)).toEqual({
      at: 1000,
      raw,
    });
    expect(localStorage.getItem("financeflow:backup:v3")).toBeNull();
  });

  // F3: the starvation case, at the level of the two helpers. A rolling
  // promotion a minute earlier must not consume the pre-migration slot.
  it("is not starved by a rolling promotion taken moments earlier", () => {
    const yesterdaysDoc = JSON.stringify({ version: 3, doc: "24h stale" });
    const atMigration = JSON.stringify({ version: 3, doc: "the bytes being migrated" });

    maybePromoteBackup(yesterdaysDoc, 1000); // rolling snapshot, occupies backup:v3
    expect(backupPreMigration(3, atMigration, 61_000)).toBe(true);

    // Two distinct slots, each holding what its own policy says it should.
    expect(JSON.parse(localStorage.getItem("financeflow:backup:v3")!).raw).toBe(yesterdaysDoc);
    expect(JSON.parse(localStorage.getItem("financeflow:premigration:v3")!).raw).toBe(atMigration);

    // ...and the fresher of the two is what recovery offers.
    expect(readLatestBackup()).toEqual({ at: 61_000, raw: atMigration });
  });

  it("write-once: reports success without clobbering an existing pre-migration copy", () => {
    const keeper = JSON.stringify({ version: 3, doc: "the one to keep" });
    expect(backupPreMigration(3, keeper, 1000)).toBe(true);
    expect(backupPreMigration(3, JSON.stringify({ version: 3, doc: "newer" }), 2000)).toBe(true);

    expect(JSON.parse(localStorage.getItem("financeflow:premigration:v3")!)).toEqual({
      at: 1000,
      raw: keeper,
    });
  });

  it("reports failure — does NOT swallow it — when the write can't be made", () => {
    failWritesTo(/^financeflow:premigration:/);

    expect(backupPreMigration(3, JSON.stringify({ version: 3 }), 1000)).toBe(false);
    expect(localStorage.getItem("financeflow:premigration:v3")).toBeNull();
  });

  it("a failed rolling promotion stays best-effort and throws nothing", () => {
    failWritesTo(/^financeflow:backup:/);

    expect(() => maybePromoteBackup(JSON.stringify({ version: 3 }), 1000)).not.toThrow();
  });
});

describe("readLatestBackup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing has ever been backed up", () => {
    expect(readLatestBackup()).toBeNull();
  });

  it("returns the newest envelope across multiple version keys", () => {
    localStorage.setItem(
      "financeflow:backup:v3",
      JSON.stringify({ at: 1000, raw: '{"version":3,"doc":"old"}' }),
    );
    localStorage.setItem(
      "financeflow:backup:v4",
      JSON.stringify({ at: 2000, raw: '{"version":4,"doc":"new"}' }),
    );
    const latest = readLatestBackup();
    expect(latest?.at).toBe(2000);
    expect(latest?.raw).toBe('{"version":4,"doc":"new"}');
  });

  // F3: the two mechanisms have separate keys now, so recovery has to read
  // both prefixes and offer the freshest — in EITHER direction.
  it("prefers the freshest across the rolling and pre-migration prefixes", () => {
    localStorage.setItem(
      "financeflow:premigration:v3",
      JSON.stringify({ at: 1000, raw: '{"version":3,"doc":"at migration"}' }),
    );
    localStorage.setItem(
      "financeflow:backup:v4",
      JSON.stringify({ at: 2000, raw: '{"version":4,"doc":"rolling, newer"}' }),
    );
    expect(readLatestBackup()?.raw).toBe('{"version":4,"doc":"rolling, newer"}');

    // Same two keys, opposite ages: the pre-migration copy now wins.
    localStorage.setItem(
      "financeflow:premigration:v3",
      JSON.stringify({ at: 3000, raw: '{"version":3,"doc":"at migration"}' }),
    );
    expect(readLatestBackup()?.raw).toBe('{"version":3,"doc":"at migration"}');
  });

  it("skips an unreadable envelope under a backup-prefixed key instead of throwing", () => {
    localStorage.setItem("financeflow:backup:v3", "{not json");
    localStorage.setItem(
      "financeflow:backup:v4",
      JSON.stringify({ at: 500, raw: '{"version":4}' }),
    );
    expect(readLatestBackup()).toEqual({ at: 500, raw: '{"version":4}' });
  });

  it("ignores keys that merely share the prefix loosely but aren't real envelopes", () => {
    localStorage.setItem("financeflow:backup:v3", JSON.stringify({ at: "not a number", raw: 5 }));
    expect(readLatestBackup()).toBeNull();
  });
});
