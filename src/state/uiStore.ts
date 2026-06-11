import { create } from "zustand";
import type { NodeId } from "./schema";
import type { Direction } from "../theme/motion";

export type ViewMode = "focus" | "overview" | "shelf" | "budget";

export type PendingCelebration = { id: NodeId; onPath: boolean };

type UIStore = {
  view: ViewMode;
  focusedId: NodeId | null;
  direction: Direction;
  soundOn: boolean;
  pendingCelebration: PendingCelebration | null;
  pendingMedal: number | null;
  setView: (v: ViewMode) => void;
  setFocus: (id: NodeId | null, direction?: Direction) => void;
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
  setView: (v) => set({ view: v }),
  setFocus: (id, direction = "none") => set({ focusedId: id, direction, view: "focus" }),
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  triggerCelebration: (id, onPath) => set({ pendingCelebration: { id, onPath } }),
  clearCelebration: () => set({ pendingCelebration: null }),
  triggerMedal: (phase) => set({ pendingMedal: phase }),
  clearMedal: () => set({ pendingMedal: null }),
}));
