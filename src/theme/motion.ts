import type { Transition } from "framer-motion";

export const EASE_FLOW: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const M = {
  flow: { type: "spring", stiffness: 110, damping: 24, mass: 1 } as Transition,
  flowLong: { type: "spring", stiffness: 70, damping: 26, mass: 1.1 } as Transition,
  flowSnap: { type: "spring", stiffness: 220, damping: 28 } as Transition,
  bar: { type: "spring", stiffness: 55, damping: 26, mass: 1 } as Transition,
  fade: { duration: 0.55, ease: EASE_FLOW } as Transition,
  fadeQuick: { duration: 0.32, ease: EASE_FLOW } as Transition,
  bloom: { duration: 1.4, ease: EASE_FLOW } as Transition,
  morph: { duration: 0.6, ease: EASE_FLOW } as Transition,
};

export const SWIPE_THRESHOLD = 90;
