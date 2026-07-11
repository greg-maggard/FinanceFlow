import "@testing-library/jest-dom";

// Node >=25 defines a global `localStorage` that is undefined unless the
// process is started with --localstorage-file; it shadows jsdom's Storage
// when Vitest populates globals. Install an in-memory stand-in so the
// store's persistence subscription works under any Node version.
if (typeof localStorage === "undefined" || localStorage == null) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}
