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

/**
 * The one-shot pre-migration copy lives under its OWN prefix, separate from
 * the rolling backup above.
 *
 * They used to share `financeflow:backup:v<n>`, and the two policies on that
 * one slot are incompatible: the rolling promotion writes at most once per 24h,
 * the pre-migration copy must capture the bytes at one specific instant, and
 * never-clobber (correct for both individually) resolves the collision by
 * discarding the pre-migration bytes. A rolling promotion that happened to fire
 * a minute before the upgrade left the slot occupied by a *stale* document —
 * up to 24h stale — at the single moment the D7 net exists to catch anything.
 * Two prefixes, two policies, no starvation; `readLatestBackup` reads both.
 */
const PREMIGRATION_PREFIX = "financeflow:premigration:v";

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
 * The one-shot backup taken at the moment a document is migrated to a new
 * schema version (money-migration-v4.md D7 / §5 step 8), given the RAW
 * pre-migration bytes exactly as they were read from storage.
 *
 * `maybePromoteBackup` above is a *rolling* 24h snapshot and is not enough on
 * its own for this: if it happened to promote a v3 envelope earlier the same
 * day, the throttle would skip the promotion on the first v4 write and the
 * bytes that existed at the instant of migration would be gone. Migration is a
 * once-ever event for a given document, so it gets its own unthrottled write
 * under its own key prefix (see PREMIGRATION_PREFIX).
 *
 * Write-once: an existing envelope under that version key is already a
 * pre-migration document of the same schema, and overwriting it would trade a
 * known-good backup for a newer one at exactly the moment the user is most
 * likely to need the older. Writes only into an empty slot.
 *
 * Returns whether a pre-migration backup for `version` is in place — `true`
 * when one was just written OR was already there, `false` when the write
 * failed. NOT best-effort, unlike `maybePromoteBackup`: this result GATES the
 * migration in store.ts. The failure that matters is a full quota, and it is
 * not independent of the live write that follows — this call *adds* a second
 * whole copy of the document while the live save merely *replaces* one, so
 * under quota pressure this is precisely what fails and the overwrite is
 * precisely what succeeds. Swallowing it means the pre-migration bytes are
 * gone with no copy anywhere and no signal to the user.
 */
export function backupPreMigration(
  version: number,
  liveRaw: string,
  now: number = Date.now(),
): boolean {
  if (typeof localStorage === "undefined") return true; // nothing to protect
  const key = `${PREMIGRATION_PREFIX}${version}`;
  if (localStorage.getItem(key)) return true; // already parked, don't clobber
  try {
    const envelope: BackupEnvelope = { at: now, raw: liveRaw };
    localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/**
 * The most recently written backup across every version key of BOTH kinds —
 * rolling (`financeflow:backup:v<n>`) and pre-migration
 * (`financeflow:premigration:v<n>`) — for RecoveryScreen's restore option and
 * SettingsModal's "Last backup" line. Freshest `at` wins, so whichever of the
 * two mechanisms last captured the document is what gets offered; neither can
 * hide the other now that they no longer share a slot.
 *
 * Deliberately version-agnostic: io.ts's migrate() already accepts v1/v2/v3
 * documents, so whichever key holds the newest envelope is the right one to
 * offer, with no hardcoded "current version" to keep in sync here.
 */
export function readLatestBackup(): BackupInfo | null {
  if (typeof localStorage === "undefined") return null;
  let best: BackupInfo | null = null;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !(key.startsWith(BACKUP_PREFIX) || key.startsWith(PREMIGRATION_PREFIX))) continue;
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
