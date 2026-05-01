import type { Phase } from "../graph/flowchart";

export type PhaseColor = {
  base: string;
  glow: string;
  tint: string;
  text: string;
};

export const PHASE_COLORS: Record<Phase, PhaseColor> = {
  0: {
    base: "#94a3b8",
    glow: "rgba(148, 163, 184, 0.55)",
    tint: "rgba(148, 163, 184, 0.18)",
    text: "#cbd5e1",
  },
  1: {
    base: "#f87171",
    glow: "rgba(248, 113, 113, 0.55)",
    tint: "rgba(248, 113, 113, 0.18)",
    text: "#fca5a5",
  },
  2: {
    base: "#fbbf24",
    glow: "rgba(251, 191, 36, 0.55)",
    tint: "rgba(251, 191, 36, 0.18)",
    text: "#fcd34d",
  },
  3: {
    base: "#34d399",
    glow: "rgba(52, 211, 153, 0.55)",
    tint: "rgba(52, 211, 153, 0.18)",
    text: "#6ee7b7",
  },
  4: {
    base: "#60a5fa",
    glow: "rgba(96, 165, 250, 0.55)",
    tint: "rgba(96, 165, 250, 0.18)",
    text: "#93c5fd",
  },
  5: {
    base: "#3b82f6",
    glow: "rgba(59, 130, 246, 0.55)",
    tint: "rgba(59, 130, 246, 0.18)",
    text: "#bfdbfe",
  },
  6: {
    base: "#a78bfa",
    glow: "rgba(167, 139, 250, 0.55)",
    tint: "rgba(167, 139, 250, 0.18)",
    text: "#c4b5fd",
  },
};
