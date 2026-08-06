import { motion } from "framer-motion";
import { GRAPH, PHASE_LABELS, type Phase } from "../graph/flowchart";
import { PHASE_COLORS } from "../theme/phaseColors";
import { M } from "../theme/motion";
import { useStore } from "../state/store";
import { useUI } from "../state/uiStore";
import { deriveStatus } from "../graph/derive";
import { useMemo } from "react";

const PHASES: Phase[] = [0, 1, 2, 3, 4, 5, 6];

export function PhaseTrail({ activePhase }: { activePhase: Phase }) {
  const state = useStore();
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const status = useMemo(() => deriveStatus(state), [state]);

  const phaseProgress = useMemo(() => {
    return PHASES.map((p) => {
      const tasks = GRAPH.filter((n) => n.phase === p && n.kind === "task");
      const reachable = tasks.filter((n) => status[n.id] !== "skipped");
      const done = reachable.filter((n) => state.nodes[n.id].completed).length;
      const total = reachable.length || 1;
      return { phase: p, done, total, pct: done / total, complete: done === total && total > 0 };
    });
  }, [state, status]);

  return (
    <motion.div
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 90, opacity: 0 }}
      transition={M.morph}
      className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4"
      style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
    >
      <motion.div
        layout
        className="relative flex items-center gap-2 rounded-full px-3 py-2"
        style={{
          background: "rgba(12, 14, 22, 0.55)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.18), 0 14px 40px rgba(0,0,0,0.55)",
        }}
      >
        {PHASES.map((p) => {
          const isActive = p === activePhase;
          const c = PHASE_COLORS[p];
          const prog = phaseProgress[p];
          return (
            <motion.button
              key={p}
              layoutId={`phase-pill-${p}`}
              onClick={(e) => {
                e.stopPropagation();
                setView(view === "overview" ? "focus" : "overview");
              }}
              whileHover={{ scale: 1.06, y: -2 }}
              whileTap={{ scale: 0.96 }}
              transition={{ layout: M.morphLong, default: M.flow }}
              className="group relative flex items-center justify-center"
              style={{
                width: isActive ? 44 : 28,
                height: isActive ? 44 : 28,
              }}
              aria-label={PHASE_LABELS[p]}
            >
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  background: prog.complete
                    ? `radial-gradient(circle, ${c.glow}, ${c.tint})`
                    : isActive
                      ? `radial-gradient(circle, ${c.tint}, transparent 70%)`
                      : "transparent",
                  border: `1px solid ${prog.complete ? c.base : isActive ? c.base : "rgba(255,255,255,0.16)"}`,
                  boxShadow: isActive
                    ? `0 0 18px ${c.glow}, inset 0 1px 0 rgba(255,255,255,0.2)`
                    : prog.complete
                      ? `0 0 12px ${c.glow}`
                      : "none",
                  opacity: prog.complete ? 1 : isActive ? 1 : 0.55,
                }}
              />
              <span
                className="relative text-[10px] font-bold"
                style={{ color: prog.complete || isActive ? c.text : "rgba(255,255,255,0.6)" }}
              >
                {prog.complete ? "✓" : p}
              </span>
              {isActive && prog.total > 0 && (
                <svg
                  className="absolute inset-[-3px] -rotate-90"
                  viewBox="0 0 50 50"
                  width={50}
                  height={50}
                >
                  <circle
                    cx="25"
                    cy="25"
                    r="22"
                    fill="none"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="2"
                  />
                  <motion.circle
                    cx="25"
                    cy="25"
                    r="22"
                    fill="none"
                    stroke={c.base}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={138.2}
                    initial={false}
                    animate={{ strokeDashoffset: 138.2 * (1 - prog.pct) }}
                    transition={M.bar}
                    style={{ filter: `drop-shadow(0 0 4px ${c.glow})` }}
                  />
                </svg>
              )}
            </motion.button>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
