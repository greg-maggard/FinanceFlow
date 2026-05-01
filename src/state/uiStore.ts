import { create } from "zustand";
import type { NodeId } from "./schema";

export type ViewMode = "focus" | "overview" | "shelf";

type UIStore = {
  view: ViewMode;
  focusedId: NodeId | null;
  soundOn: boolean;
  pendingCelebration: NodeId | null;
  pendingMedal: number | null;
  setView: (v: ViewMode) => void;
  setFocus: (id: NodeId | null) => void;
  toggleSound: () => void;
  triggerCelebration: (id: NodeId) => void;
  clearCelebration: () => void;
  triggerMedal: (phase: number) => void;
  clearMedal: () => void;
};

export const useUI = create<UIStore>((set) => ({
  view: "focus",
  focusedId: null,
  soundOn: false,
  pendingCelebration: null,
  pendingMedal: null,
  setView: (v) => set({ view: v }),
  setFocus: (id) => set({ focusedId: id, view: "focus" }),
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  triggerCelebration: (id) => set({ pendingCelebration: id }),
  clearCelebration: () => set({ pendingCelebration: null }),
  triggerMedal: (phase) => set({ pendingMedal: phase }),
  clearMedal: () => set({ pendingMedal: null }),
}));
