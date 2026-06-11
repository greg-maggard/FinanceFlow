import { create } from "zustand";
import type { NodeId } from "./schema";
import type { Direction } from "../theme/motion";

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
  setView: (v: ViewMode) => void;
  setFocus: (id: NodeId | null, direction?: Direction) => void;
  openInBudget: (target: BudgetFocus) => void;
  clearBudgetFocus: () => void;
  toggleSound: () => void;
  triggerCelebration: (id: NodeId, onPath: boolean) => void;
  clearCelebration: () => void;
  triggerMedal: (phase: number) => void;
  clearMedal: () => void;
};

export const useUI = create<UIStore>((set) => ({
  view: "focus",
  focusedId: null,
  direction: "none",
  soundOn: false,
  pendingCelebration: null,
  pendingMedal: null,
  budgetFocus: null,
  setView: (v) => set({ view: v }),
  setFocus: (id, direction = "none") => set({ focusedId: id, direction, view: "focus" }),
  openInBudget: (target) => set({ view: "budget", budgetFocus: target }),
  clearBudgetFocus: () => set({ budgetFocus: null }),
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  triggerCelebration: (id, onPath) => set({ pendingCelebration: { id, onPath } }),
  clearCelebration: () => set({ pendingCelebration: null }),
  triggerMedal: (phase) => set({ pendingMedal: phase }),
  clearMedal: () => set({ pendingMedal: null }),
}));
