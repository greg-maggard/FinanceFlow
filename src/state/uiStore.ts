import { create } from "zustand";
import type { BudgetBook, NodeId, Txn } from "./schema";
import type { Direction } from "../theme/motion";
import { flushSave } from "./store";

export type ViewMode = "focus" | "overview" | "shelf" | "budget";

export type PendingCelebration = { id: NodeId; onPath: boolean };

/** Where a cross-navigation jump into the Budget screen should land. */
export type BudgetFocus = { categoryId?: string; accountId?: string };

/**
 * What a five-second undo toast (w3-search-undo, see UndoToast.tsx) is
 * holding. A transaction delete parks the exact removed row(s) — a
 * transfer's two legs come back together. A category delete reassigns
 * transactions and merges monthly assignments, so nothing narrower than the
 * entire pre-delete book slice round-trips byte-for-byte; that slice is
 * captured by the caller (CategoryGroups) before deleteCategory runs.
 * Deliberately in-memory only — never persisted, never written to the
 * document as a tombstone. It's either restored before the toast expires,
 * or it's gone for good.
 */
export type PendingUndo =
  | { kind: "txn"; message: string; txns: Txn[] }
  | { kind: "category"; message: string; budget: BudgetBook };

/**
 * Fast-entry memory (w2-fastentry): the account and, per account, the
 * category most recently used when logging a transaction from the FAB.
 * Lets the fast path pre-fill both without ever landing on blank — the
 * worst case is a stale-but-honest guess the user overrides in two taps.
 */
export type LastUsedTxn = {
  accountId: string;
  categoryByAccount: Record<string, string>;
};

type UIStore = {
  view: ViewMode;
  focusedId: NodeId | null;
  direction: Direction;
  soundOn: boolean;
  pendingCelebration: PendingCelebration | null;
  pendingMedal: number | null;
  /** Pending one-shot scroll/pulse request; BudgetScreen consumes it. */
  budgetFocus: BudgetFocus | null;
  /** Most-recently-used account/category pair for the fast-entry FAB; null
   *  until the first transaction is ever logged from it. Persisted (see
   *  writePersistedUi below) so it survives a reload. */
  lastUsedTxn: LastUsedTxn | null;
  /**
   * Non-null when the most recent persistence write failed (quota exceeded,
   * Safari private mode, storage eviction, ...). Drives the persistent
   * banner in TopBar; cleared automatically by the next successful save, or
   * manually by dismissing the banner.
   */
  saveError: string | null;
  /** Epoch ms of the most recent successful persistence write, for the
   *  "Last saved" read-out in SettingsModal. */
  lastSavedAt: number | null;
  /**
   * Non-null once this tab's `storage` listener (see store.ts, F12) sees a
   * persisted document with a higher write-seq than this tab has ever
   * written — i.e. another tab or the installed PWA saved something newer.
   * Unlike saveError this is blocking and has no dismiss action: store.ts
   * has already suspended the persistence subscription for the rest of the
   * session, so the only way out is the reload this message asks for.
   */
  staleTab: string | null;
  /** True once the PWA service worker reports a new version is waiting.
   *  Drives the non-blocking update banner in TopBar; see setPwaUpdateHandler
   *  below for how the reload itself is triggered. */
  needRefresh: boolean;
  /** Non-null while a delete's five-second undo window is open; null once
   *  it's accepted, expired, or superseded by a newer delete. See
   *  PendingUndo and UndoToast.tsx. */
  pendingUndo: PendingUndo | null;
  setView: (v: ViewMode) => void;
  setFocus: (id: NodeId | null, direction?: Direction) => void;
  openInBudget: (target: BudgetFocus) => void;
  clearBudgetFocus: () => void;
  /** Remembers this (account, category) pair as the most recent for that
   *  account, for the fast-entry FAB's next pre-fill. */
  recordTxnUsage: (accountId: string, categoryId: string) => void;
  toggleSound: () => void;
  triggerCelebration: (id: NodeId, onPath: boolean) => void;
  clearCelebration: () => void;
  triggerMedal: (phase: number) => void;
  clearMedal: () => void;
  setSaveError: (message: string | null) => void;
  clearSaveError: () => void;
  setLastSaved: (at: number) => void;
  setNeedRefresh: (v: boolean) => void;
  setStaleTab: (message: string) => void;
  setPendingUndo: (u: PendingUndo | null) => void;
};

/**
 * Persists `view`/`focusedId` — where the user is — and (w2-fastentry)
 * `lastUsedTxn` — the FAB's pre-fill memory. Neither is budget data, so
 * both live under a key separate from the budget document (STORAGE_KEY in
 * store.ts) and never ride that migration chain. Everything else on
 * UIStore is a one-shot signal (celebrations, medals, budgetFocus,
 * direction) that would misfire if replayed on reload, so none of it is
 * persisted here.
 */
const UI_STORAGE_KEY = "financeflow:ui:v1";

/**
 * The only views a cold open may land on. `overview` is a transient overlay
 * (see OverviewSheet) and `shelf` has no renderer anywhere in `src/` —
 * restoring either would silently break the Today strip's 0-tap promise
 * (w2-today-strip: BudgetScreen only renders when `view === "budget"`), so
 * neither is ever written to storage, and a persisted value outside this set
 * (including a stale `shelf`) is coerced to `"budget"` on read. See
 * w2-persist-view.
 */
type RestorableView = "focus" | "budget";

type PersistedUi = { view: RestorableView; focusedId: NodeId | null; lastUsedTxn?: LastUsedTxn };

const VALID_VIEWS: RestorableView[] = ["focus", "budget"];

function isValidLastUsedTxn(v: unknown): v is LastUsedTxn {
  if (!v || typeof v !== "object") return false;
  const o = v as { accountId?: unknown; categoryByAccount?: unknown };
  if (typeof o.accountId !== "string") return false;
  if (!o.categoryByAccount || typeof o.categoryByAccount !== "object") return false;
  return Object.values(o.categoryByAccount as object).every((x) => typeof x === "string");
}

/**
 * Best-effort read of the persisted slice. Deliberately permissive: this is
 * cosmetic state, not the budget document, so any shape trouble (missing
 * key, corrupt JSON, a stale enum value from a since-renamed ViewMode)
 * just falls back to the caller's defaults rather than blocking boot the
 * way store.ts's RecoveryScreen does for real data. A `focusedId` that's
 * merely the wrong *shape* is caught here; one that's a well-formed but
 * no-longer-valid NodeId (e.g. after a graph change) is App.tsx's job to
 * catch, since only it has the graph to check against.
 */
function readPersistedUi(): Partial<PersistedUi> {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(UI_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as {
      view?: unknown;
      focusedId?: unknown;
      lastUsedTxn?: unknown;
    };
    const view = VALID_VIEWS.includes(parsed.view as RestorableView)
      ? (parsed.view as RestorableView)
      : undefined;
    const focusedId = typeof parsed.focusedId === "string" ? (parsed.focusedId as NodeId) : null;
    const lastUsedTxn = isValidLastUsedTxn(parsed.lastUsedTxn) ? parsed.lastUsedTxn : undefined;
    return { view, focusedId, lastUsedTxn };
  } catch {
    return {};
  }
}

function writePersistedUi(slice: PersistedUi): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(slice));
  } catch {
    // Best-effort: this is cosmetic UI position, not the budget document —
    // silently drop on quota exceeded / private-mode storage errors rather
    // than surfacing the saveError banner store.ts uses for real data loss.
  }
}

const persistedUi = readPersistedUi();

export const useUI = create<UIStore>((set) => ({
  // First-ever launch (nothing persisted) lands on Budget, the daily
  // surface; the flowchart (`focus`) is the monthly one. A returning user
  // lands wherever they left, via persistedUi below.
  view: persistedUi.view ?? "budget",
  focusedId: persistedUi.focusedId ?? null,
  direction: "none",
  soundOn: false,
  pendingCelebration: null,
  pendingMedal: null,
  budgetFocus: null,
  lastUsedTxn: persistedUi.lastUsedTxn ?? null,
  saveError: null,
  lastSavedAt: null,
  staleTab: null,
  needRefresh: false,
  pendingUndo: null,
  setView: (v) => set({ view: v }),
  setFocus: (id, direction = "none") => set({ focusedId: id, direction, view: "focus" }),
  openInBudget: (target) => set({ view: "budget", budgetFocus: target }),
  clearBudgetFocus: () => set({ budgetFocus: null }),
  recordTxnUsage: (accountId, categoryId) =>
    set((s) => ({
      lastUsedTxn: {
        accountId,
        categoryByAccount: { ...(s.lastUsedTxn?.categoryByAccount ?? {}), [accountId]: categoryId },
      },
    })),
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  triggerCelebration: (id, onPath) => set({ pendingCelebration: { id, onPath } }),
  clearCelebration: () => set({ pendingCelebration: null }),
  triggerMedal: (phase) => set({ pendingMedal: phase }),
  clearMedal: () => set({ pendingMedal: null }),
  setSaveError: (message) => set({ saveError: message }),
  clearSaveError: () => set({ saveError: null }),
  setLastSaved: (at) => set({ lastSavedAt: at }),
  setNeedRefresh: (v) => set({ needRefresh: v }),
  // Once set, this never gets cleared by anything short of a fresh module
  // load (i.e. a reload) — see the `staleTab` doc comment above.
  setStaleTab: (message) => set({ staleTab: message }),
  setPendingUndo: (u) => set({ pendingUndo: u }),
}));

// The most recently seen restorable (`focus`/`budget`) view. Landing on
// `overview` (or a stale `shelf`) mid-session must not overwrite the real
// view a cold open should return to — see the `RestorableView` doc comment
// above — so this only advances when `state.view` is itself restorable, and
// every write below persists this rather than `state.view` verbatim.
let restorableView: RestorableView = persistedUi.view ?? "budget";

// Persist view/focusedId/lastUsedTxn on every change (no debounce needed at
// this write volume — see w2-persist-view, w2-fastentry). Deliberately
// narrow: only writes when one of the three persisted fields actually
// changed, so the frequent one-shot signals (pendingCelebration,
// pendingMedal, budgetFocus, ...) that also live on this store don't
// trigger a write, and are never persisted. `lastUsedTxn` is omitted from
// the written object while still null so a session that never touches the
// FAB persists exactly the same two-key shape as before this field existed.
useUI.subscribe((state, prevState) => {
  if (
    state.view === prevState.view &&
    state.focusedId === prevState.focusedId &&
    state.lastUsedTxn === prevState.lastUsedTxn
  )
    return;
  if (state.view === "focus" || state.view === "budget") restorableView = state.view;
  writePersistedUi({
    view: restorableView,
    focusedId: state.focusedId,
    ...(state.lastUsedTxn ? { lastUsedTxn: state.lastUsedTxn } : {}),
  });
});

// The Workbox-provided reload trigger (from virtual:pwa-register's
// registerSW) is a function, not serializable UI state, so it lives here as
// a module-scope reference rather than in the store proper. main.tsx wires
// it up once at startup; TopBar calls applyPwaUpdate() when the user
// confirms the update banner.
let pwaUpdateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;

export function setPwaUpdateHandler(fn: (reloadPage?: boolean) => Promise<void>): void {
  pwaUpdateFn = fn;
}

export function applyPwaUpdate(): void {
  // F13: this is the one reload the app triggers itself, so it costs
  // nothing to flush deterministically rather than rely on flushSave()'s
  // visibilitychange/pagehide wiring firing reliably before the new service
  // worker takes over (untested territory on, e.g., iOS standalone PWAs).
  flushSave();
  void pwaUpdateFn?.(true);
}
