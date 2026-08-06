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
