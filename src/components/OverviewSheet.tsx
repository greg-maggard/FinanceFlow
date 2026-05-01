import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { GRAPH, PHASE_LABELS, type Phase } from "../graph/flowchart";
import { PHASE_COLORS } from "../theme/phaseColors";
import { M } from "../theme/motion";
import { useStore } from "../state/store";
import { useUI } from "../state/uiStore";
import { deriveStatus, type Status } from "../graph/derive";
import type { NodeId } from "../state/schema";

const PHASES: Phase[] = [0, 1, 2, 3, 4, 5, 6];

function statusStyle(status: Status, base: string, glow: string, tint: string) {
  switch (status) {
    case "current":
      return {
        background: `linear-gradient(135deg, ${tint}, rgba(255,255,255,0.05))`,
        border: `1px solid ${base}`,
        boxShadow: `0 0 22px ${glow}, inset 0 1px 0 rgba(255,255,255,0.2)`,
        opacity: 1,
      };
    case "done":
      return {
        background: `linear-gradient(135deg, ${tint}, rgba(255,255,255,0.04))`,
        border: `1px solid ${base}`,
        boxShadow: `0 0 8px ${glow}`,
        opacity: 0.95,
      };
    case "skipped":
      return {
        background: "rgba(255,255,255,0.03)",
        border: "1px dashed rgba(255,255,255,0.12)",
        opacity: 0.32,
      };
    default:
      return {
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.10)",
        opacity: 0.65,
      };
  }
}

export function OverviewSheet() {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const setFocus = useUI((s) => s.setFocus);
  const triggerCelebration = useUI((s) => s.triggerCelebration);
  const state = useStore();
  const status = useMemo(() => deriveStatus(state), [state]);

  const toggle = (id: NodeId) => {
    const wasComplete = state.nodes[id].completed;
    useStore.getState().toggleComplete(id);
    if (!wasComplete) triggerCelebration(id);
  };

  return (
    <AnimatePresence>
      {view === "overview" && (
        <motion.div
          key="overview"
          className="fixed inset-0 z-20 overflow-y-auto pb-32 pt-20"
          initial={{ opacity: 0, scale: 1.02, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 1.02, filter: "blur(8px)" }}
          transition={M.morph}
          onClick={() => setView("focus")}
        >
          <div className="mx-auto max-w-5xl px-6" onClick={(e) => e.stopPropagation()}>
            <motion.div
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ ...M.fade, delay: 0.1 }}
              className="mb-6 flex items-center justify-between"
            >
              <h2 className="text-lg font-semibold tracking-tight text-white/90">
                Overview
              </h2>
              <button
                onClick={() => setView("focus")}
                className="rounded-full px-3 py-1.5 text-xs text-white/70 hover:text-white/95"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                Back to focus ↩
              </button>
            </motion.div>

            <div className="grid gap-5">
              {PHASES.map((phase, phaseIdx) => {
                const c = PHASE_COLORS[phase];
                const phaseNodes = GRAPH.filter((n) => n.phase === phase);
                return (
                  <motion.section
                    key={phase}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...M.fade, delay: 0.06 * phaseIdx }}
                    className="space-y-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                        style={{
                          background: `radial-gradient(circle, ${c.tint}, transparent 70%)`,
                          border: `1px solid ${c.base}`,
                          color: c.text,
                          boxShadow: `0 0 10px ${c.glow}`,
                        }}
                      >
                        {phase}
                      </div>
                      <div className="text-xs uppercase tracking-[0.22em] text-white/55">
                        {PHASE_LABELS[phase].replace(/^Step \d+: /, "")}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {phaseNodes.map((n) => {
                        const s = status[n.id];
                        const completed = state.nodes[n.id].completed;
                        const style = statusStyle(s, c.base, c.glow, c.tint);
                        const isCheckable = n.kind === "task";
                        return (
                          <motion.div
                            key={n.id}
                            layout
                            whileHover={{ scale: 1.015, y: -1 }}
                            whileTap={{ scale: 0.985 }}
                            transition={M.flowSnap}
                            onClick={() => setFocus(n.id)}
                            className="cursor-pointer rounded-2xl px-4 py-3 text-left"
                            style={{
                              ...style,
                              backdropFilter: "blur(18px) saturate(180%)",
                              WebkitBackdropFilter: "blur(18px) saturate(180%)",
                            }}
                          >
                            <div className="flex items-start gap-2">
                              {isCheckable ? (
                                <motion.button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(n.id);
                                  }}
                                  whileTap={{ scale: 0.85 }}
                                  whileHover={{ scale: 1.08 }}
                                  transition={M.flowSnap}
                                  aria-label={completed ? "Mark incomplete" : "Mark complete"}
                                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                                  style={{
                                    background: completed ? c.base : "rgba(255,255,255,0.04)",
                                    border: completed
                                      ? `1px solid ${c.base}`
                                      : "1px solid rgba(255,255,255,0.22)",
                                    boxShadow: completed
                                      ? `0 0 12px ${c.glow}, inset 0 1px 0 rgba(255,255,255,0.25)`
                                      : "inset 0 1px 0 rgba(255,255,255,0.05)",
                                  }}
                                >
                                  {completed && (
                                    <motion.svg
                                      initial={{ scale: 0, rotate: -25 }}
                                      animate={{ scale: 1, rotate: 0 }}
                                      transition={M.flowSnap}
                                      viewBox="0 0 12 12"
                                      className="h-3 w-3 text-white"
                                    >
                                      <path
                                        d="M2 6 L5 9 L10 3"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        fill="none"
                                      />
                                    </motion.svg>
                                  )}
                                </motion.button>
                              ) : (
                                <span
                                  className="mt-0.5 inline-block rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide"
                                  style={{
                                    background: c.tint,
                                    color: c.text,
                                    border: `1px solid ${c.base}`,
                                  }}
                                >
                                  ?
                                </span>
                              )}
                              <div className="flex-1">
                                <div className="text-sm font-medium leading-snug text-white/95">
                                  {n.label}
                                </div>
                                {n.sublabel && (
                                  <div className="text-[11px] italic text-white/50">
                                    {n.sublabel}
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.section>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
