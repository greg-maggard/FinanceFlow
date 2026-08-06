/**
 * Test helper: make localStorage writes to selected keys fail the way a full
 * quota does, leaving every other key writable.
 *
 * That asymmetry is the point, not a convenience — see F2 in the Wave 3
 * review. A pre-migration backup ADDS a whole second copy of the document
 * while the live save merely REPLACES an existing value, so under quota
 * pressure the backup is precisely what fails and the overwrite is precisely
 * what succeeds. A blunt "everything throws" stub cannot reproduce the bug.
 *
 * Swaps the global rather than spying on a method: depending on Node version,
 * `localStorage` is either a jsdom `Storage` (proxied, so patching an own
 * property is unreliable) or the plain in-memory stand-in installed by
 * `src/test/setup.ts`. Replacing the binding works for both. Always pair with
 * `restoreStorage()` in an `afterEach`.
 */

let saved: typeof globalThis.localStorage | null = null;

function install(value: unknown): void {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value });
}

export function failWritesTo(pattern: RegExp): void {
  const real = globalThis.localStorage;
  saved ??= real;
  install({
    getItem: (key: string) => real.getItem(key),
    setItem: (key: string, value: string) => {
      if (pattern.test(key)) throw new DOMException("quota exceeded", "QuotaExceededError");
      real.setItem(key, value);
    },
    removeItem: (key: string) => real.removeItem(key),
    clear: () => real.clear(),
    key: (index: number) => real.key(index),
    get length() {
      return real.length;
    },
  });
}

export function restoreStorage(): void {
  if (saved) {
    install(saved);
    saved = null;
  }
}
