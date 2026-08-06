import type { AppState } from "./schema";

export interface StorageAdapter {
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<void>;
}

const KEY = "financeflow:state:v1";

/**
 * Thrown by LocalStorageAdapter.save() when the underlying `setItem` call
 * fails — quota exceeded, Safari private mode, or storage eviction all land
 * here instead of failing invisibly. `quotaExceeded` lets callers show a more
 * specific message without re-inspecting the original DOM exception.
 */
export class StorageError extends Error {
  readonly quotaExceeded: boolean;

  constructor(message: string, quotaExceeded: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageError";
    this.quotaExceeded = quotaExceeded;
  }
}

function isQuotaExceededError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  // Chrome/Safari (current) use the standardized name; older Safari/Firefox
  // surfaced the same condition as legacy numeric code 22.
  return err.name === "QuotaExceededError" || err.code === 22;
}

export class LocalStorageAdapter implements StorageAdapter {
  async load(): Promise<AppState | null> {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw) as AppState;
    } catch {
      return null;
    }
  }

  async save(state: AppState): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      const quotaExceeded = isQuotaExceededError(err);
      throw new StorageError(
        quotaExceeded
          ? "Storage quota exceeded — the browser's local storage is full."
          : "Failed to write to local storage.",
        quotaExceeded,
        { cause: err },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// w3-backup-key: rolling last-known-good backup.
//
// THREAT MODEL — read this before assuming more protection than exists. The
// backup key lives in the same evictable localStorage origin as the live key
// above. This guards against document corruption or a bad migration
// clobbering the live key — it does NOT guard against storage eviction
// (Safari's 7-day cap, "clear browsing data", low-disk eviction) or a
// lost/wiped device, since both keys vanish together in every one of those
// cases. Manual Export (SettingsModal → Backup) remains the only off-device
// copy until a real sync story exists.

const BACKUP_PREFIX = "financeflow:backup:v";
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface BackupEnvelope {
  at: number;
  raw: string;
}

/** What RecoveryScreen and SettingsModal need: when the snapshot was taken,
 *  and the raw bytes to feed back through io.ts's migrate() if restored. */
export interface BackupInfo {
  at: number;
  raw: string;
}

function parseVersion(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "number" ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Called once per live write, with the bytes about to be overwritten (or
 * `null` on the very first-ever save, when there's nothing yet to protect).
 * Promotes `liveRaw` to its OWN version's backup key — parsed from the bytes
 * themselves, not the incoming write — so a future schema bump (e.g. the v4
 * migration) naturally leaves the last v3 document behind under
 * `financeflow:backup:v3`, untouched by any v4-era backup. See
 * Docs/money-migration-v4.md D7, which names this exact key as its safety
 * net.
 *
 * Skips when the last promotion under that key is less than 24h old, and
 * always overwrites (never accumulates) — exactly one envelope per version
 * key, ever.
 */
export function maybePromoteBackup(liveRaw: string | null, now: number = Date.now()): void {
  if (typeof localStorage === "undefined") return;
  if (!liveRaw) return;
  const version = parseVersion(liveRaw);
  if (version === null) return; // can't attribute a version key to unparseable bytes
  const key = `${BACKUP_PREFIX}${version}`;
  const existingRaw = localStorage.getItem(key);
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw) as BackupEnvelope;
      if (typeof existing.at === "number" && now - existing.at < BACKUP_INTERVAL_MS) return;
    } catch {
      // Unreadable envelope — fall through and overwrite it below.
    }
  }
  try {
    const envelope: BackupEnvelope = { at: now, raw: liveRaw };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Best-effort: a failed backup write must never block or throw into the
    // live save path — losing this backup opportunity beats losing the
    // ability to save at all. The 24h throttle above means we'll retry
    // naturally on a later write.
  }
}

/**
 * The most recently promoted backup across every version key present, for
 * RecoveryScreen's restore option and SettingsModal's "Last backup" line.
 * Deliberately version-agnostic: io.ts's migrate() already accepts v1/v2/v3
 * documents, so whichever version key holds the newest envelope is the right
 * one to offer, with no hardcoded "current version" to keep in sync here.
 */
export function readLatestBackup(): BackupInfo | null {
  if (typeof localStorage === "undefined") return null;
  let best: BackupInfo | null = null;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(BACKUP_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const envelope = JSON.parse(raw) as BackupEnvelope;
      if (typeof envelope.at !== "number" || typeof envelope.raw !== "string") continue;
      if (!best || envelope.at > best.at) best = envelope;
    } catch {
      continue;
    }
  }
  return best;
}
