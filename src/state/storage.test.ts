import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maybePromoteBackup, readLatestBackup } from "./storage";

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
