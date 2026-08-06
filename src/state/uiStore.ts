import { create } from "zustand";
import type { NodeId } from "./schema";
import type { Direction } from "../theme/motion";
import { flushSave } from "./store";

export type ViewMode = "focus" | "overview" | "shelf" | "budget";

export type PendingCelebration = { id: NodeId; onPath: boolean };

/** Where a cross-navigation jump into the Budget screen should land. */
export type BudgetFocus = { categoryId?: string; accountId?: string };

type UIStore = {
  view: ViewMode;
  focusedId: NodeId | null;
  direction: Direction;
  soundOn: boolean;
  pendingCelebration: PendingCelebration | null;
  pendingMedal: number | null;
  /** Pending one-shot scroll/pulse request; BudgetScreen consumes it. */
  budgetFocus: BudgetFocus | null;
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
  setView: (v: ViewMode) => void;
  setFocus: (id: NodeId | null, direction?: Direction) => void;
  openInBudget: (target: BudgetFocus) => void;
  clearBudgetFocus: () => void;
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
};

export const useUI = create<UIStore>((set) => ({
  view: "focus",
  focusedId: null,
  direction: "none",
  soundOn: false,
  pendingCelebration: null,
  pendingMedal: null,
  budgetFocus: null,
  saveError: null,
  lastSavedAt: null,
  staleTab: null,
  needRefresh: false,
  setView: (v) => set({ view: v }),
  setFocus: (id, direction = "none") => set({ focusedId: id, direction, view: "focus" }),
  openInBudget: (target) => set({ view: "budget", budgetFocus: target }),
  clearBudgetFocus: () => set({ budgetFocus: null }),
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
}));

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
